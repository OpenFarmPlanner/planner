"""API endpoints for the projects domain (projects, memberships, invitations, agent login)."""

import logging

from django.conf import settings
from django.contrib.auth import login
from django.http import HttpResponseBadRequest, HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect
from django.utils import timezone
from django.utils.crypto import get_random_string
from django.utils.text import slugify
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.demo_access import guest_demo_forbidden_response, is_active_guest_demo_user
from accounts.models import UserProjectSettings
from config.frontend_urls import build_public_frontend_url
from config.responses import api_error_response
from farm.models import AgentLoginToken, Location, Project, ProjectInvitation, ProjectMembership
from farm.project_context import require_project_admin, resolve_project_for_user
from farm.services.demo_project import create_personal_demo_project, resolve_demo_request_language
from farm.services.project_invitations import (
    InvitationFlowError,
    accept_invitation,
    accept_pending_invitation_from_session,
    build_public_status,
    clear_pending_invitation_token,
    create_or_resend_invitation,
    get_invitation_by_token,
    get_pending_invitation_token,
    revoke_invitation,
    store_pending_invitation_token,
)

from .emails import _send_project_invitation_email
from .serializers import (
    InvitationTokenSerializer,
    ProjectInvitationSerializer,
    ProjectMembershipSerializer,
    ProjectSerializer,
)

logger = logging.getLogger(__name__)


def _invitation_error_response(exc: InvitationFlowError) -> Response:
    """Build a consistent error response for invitation domain errors."""
    status_code = status.HTTP_403_FORBIDDEN if exc.code == 'email_mismatch' else status.HTTP_400_BAD_REQUEST
    return api_error_response(code=exc.code, detail=exc.message, status_code=status_code)


def agent_login_consume_view(request, token: str):  # noqa: ANN001
    """Use an agent login token, establish session, and redirect to frontend."""
    if not getattr(settings, 'AGENT_LOGIN_ENABLED', False):
        return HttpResponseForbidden('Agent login is disabled.')

    token_hash = AgentLoginToken.hash_token(token)
    link = AgentLoginToken.objects.select_related('created_by', 'project').filter(token_hash=token_hash).first()
    if link is None:
        return HttpResponseBadRequest('Invalid token.')
    if link.used_at is not None:
        return HttpResponseBadRequest('Token already used.')
    if link.expires_at is not None and timezone.now() >= link.expires_at:
        return HttpResponseBadRequest('Token expired.')
    if not link.created_by.is_active or not link.created_by.is_superuser:
        return HttpResponseForbidden('Token creator is not allowed.')

    login(request, link.created_by)
    link.used_at = timezone.now()
    link.used_by_ip = request.META.get('REMOTE_ADDR')
    link.used_user_agent = (request.META.get('HTTP_USER_AGENT', '') or '')[:512]
    link.save(update_fields=['used_at', 'used_by_ip', 'used_user_agent'])

    request.session['agent_mode'] = True
    request.session['agent_project_id'] = link.project_id
    request.session.modified = True

    return redirect(build_public_frontend_url('/app/crops'))


def _apply_invitation_project_settings(*, user, project: Project) -> dict[str, int | str]:
    """Persist accepted invitation project as active/default project and return payload."""
    settings_obj, _ = UserProjectSettings.objects.get_or_create(user=user)
    settings_obj.default_project = project
    settings_obj.last_project = project
    settings_obj.save(update_fields=['default_project', 'last_project', 'updated_at'])
    return {
        'id': project.id,
        'name': project.name,
        'slug': project.slug,
    }


def _build_unique_project_slug(name: str) -> str:
    """Generate a unique project slug from a project name."""
    base_slug = slugify(name) or get_random_string(8).lower()
    candidate = base_slug
    suffix = 2
    while Project.objects.filter(slug=candidate).exists():
        candidate = f'{base_slug}-{suffix}'
        suffix += 1
    return candidate


class MyProjectsView(APIView):
    """Return all projects for current user with membership metadata."""

    def get(self, request):
        agent_mode = bool(request.session.get('agent_mode'))
        agent_project_id = request.session.get('agent_project_id')
        settings_obj, _ = UserProjectSettings.objects.get_or_create(user=request.user)

        if agent_mode and agent_project_id is not None:
            try:
                bound_project_id = int(agent_project_id)
            except (TypeError, ValueError):
                return api_error_response(
                    code='invalid_agent_project_binding',
                    detail='Invalid agent project binding.',
                    status_code=status.HTTP_403_FORBIDDEN,
                )

            project = get_object_or_404(Project, id=bound_project_id, is_active=True, deleted_at__isnull=True)
            return Response([
                {
                    'project': ProjectSerializer(project).data,
                    'role': ProjectMembership.ROLE_MEMBER,
                    'is_default': settings_obj.default_project_id == project.id,
                    'is_last': settings_obj.last_project_id == project.id,
                }
            ])

        memberships = ProjectMembership.objects.select_related('project').filter(
            user=request.user,
            project__is_active=True,
            project__deleted_at__isnull=True,
        )
        payload = []
        for membership in memberships:
            project = membership.project
            payload.append(
                {
                    'project': ProjectSerializer(project).data,
                    'role': membership.role,
                    'is_default': settings_obj.default_project_id == project.id,
                    'is_last': settings_obj.last_project_id == project.id,
                }
            )
        return Response(payload)


class ProjectSwitchView(APIView):
    """Switch active project for current user and persist last project."""

    def post(self, request):
        project_id = request.data.get('project_id')
        try:
            project_id = int(project_id)
        except (TypeError, ValueError):
            return api_error_response(
                code='invalid_project_id',
                detail='Invalid project_id.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        membership = ProjectMembership.objects.filter(
            user=request.user,
            project_id=project_id,
            project__is_active=True,
            project__deleted_at__isnull=True,
        ).first()
        if membership is None:
            return api_error_response(
                code='project_membership_required',
                detail='Not a member of the selected project.',
                status_code=status.HTTP_403_FORBIDDEN,
            )

        settings_obj, _ = UserProjectSettings.objects.get_or_create(user=request.user)
        settings_obj.last_project_id = project_id
        update_fields = ['last_project', 'updated_at']
        if request.data.get('set_default') is True:
            settings_obj.default_project_id = project_id
            update_fields.append('default_project')
        settings_obj.save(update_fields=update_fields)

        active_project, _ = resolve_project_for_user(request.user)
        return Response({
            'detail': 'Project switched.',
            'project_id': project_id,
            'resolved_project_id': active_project.id if active_project else None,
            'last_project_id': settings_obj.last_project_id,
            'default_project_id': settings_obj.default_project_id,
        })


class ProjectViewSet(viewsets.ModelViewSet):
    """Project CRUD for authenticated users."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ProjectSerializer
    queryset = Project.objects.filter(is_active=True, deleted_at__isnull=True)

    def get_queryset(self):
        queryset = Project.objects.filter(memberships__user=self.request.user, is_active=True).distinct()
        if self.request.query_params.get('deleted') in {'1', 'true', 'True'}:
            return queryset.filter(
                memberships__role=ProjectMembership.ROLE_ADMIN,
                deleted_at__isnull=False,
            )
        return queryset.filter(deleted_at__isnull=True)

    def create(self, request: Request, *args: object, **kwargs: object) -> Response:
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        project = serializer.save(slug=_build_unique_project_slug(serializer.validated_data['name']))
        if not Location.objects.filter(project=project).exists():
            Location.objects.create(
                project=project,
                name='Hauptstandort',
            )
        ProjectMembership.objects.get_or_create(
            user=self.request.user,
            project=project,
            defaults={'role': ProjectMembership.ROLE_ADMIN},
        )
        settings_obj, _ = UserProjectSettings.objects.get_or_create(user=self.request.user)
        if settings_obj.default_project_id is None:
            settings_obj.default_project = project
        settings_obj.last_project = project
        settings_obj.save()

    @action(detail=False, methods=['post'], url_path='create-demo')
    def create_demo(self, request: Request) -> Response:
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        try:
            result = create_personal_demo_project(user=request.user, language_code=resolve_demo_request_language(request))
        except Exception:  # noqa: BLE001
            logger.exception('Personal demo project creation failed', extra={'user_id': request.user.id})
            return Response(
                {'detail': 'Demo project could not be created.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response_status = status.HTTP_201_CREATED if result.created_project else status.HTTP_200_OK
        return Response(ProjectSerializer(result.project).data, status=response_status)

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        project = self.get_object()
        require_project_admin(request.user, project.id, request)
        project.deleted_at = timezone.now()
        project.save(update_fields=['deleted_at', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def restore(self, request: Request, pk: str | None = None) -> Response:
        project = get_object_or_404(
            Project.objects.filter(
                memberships__user=request.user,
                is_active=True,
                deleted_at__isnull=False,
            ),
            pk=pk,
        )
        require_project_admin(request.user, project.id, request)
        project.deleted_at = None
        project.save(update_fields=['deleted_at', 'updated_at'])
        return Response(ProjectSerializer(project).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['delete'])
    def permanent(self, request: Request, pk: str | None = None) -> Response:
        project = get_object_or_404(
            Project.objects.filter(
                memberships__user=request.user,
                deleted_at__isnull=False,
            ),
            pk=pk,
        )
        require_project_admin(request.user, project.id, request)
        project.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectMembersView(APIView):
    """List and mutate project memberships."""

    def get(self, request, project_id: int):
        project = get_object_or_404(Project, id=project_id, is_active=True, deleted_at__isnull=True)
        memberships = ProjectMembership.objects.select_related('user').filter(project=project, user__is_active=True)
        if not memberships.filter(user=request.user).exists():
            return api_error_response(
                code='project_membership_required',
                detail='Forbidden.',
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return Response(ProjectMembershipSerializer(memberships, many=True).data)

    def patch(self, request, project_id: int):
        get_object_or_404(Project, id=project_id, is_active=True, deleted_at__isnull=True)
        require_project_admin(request.user, project_id, request=request)
        membership_id = request.data.get('membership_id')
        role = request.data.get('role')
        membership = get_object_or_404(ProjectMembership, id=membership_id, project_id=project_id)
        if role not in {ProjectMembership.ROLE_ADMIN, ProjectMembership.ROLE_MEMBER}:
            return api_error_response(
                code='invalid_project_role',
                detail='Invalid role.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if membership.user_id == request.user.id:
            return api_error_response(
                code='self_role_change_forbidden',
                detail='You cannot change your own project role here.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        membership.role = role
        membership.save(update_fields=['role'])
        return Response(ProjectMembershipSerializer(membership).data)

    def delete(self, request, project_id: int):
        get_object_or_404(Project, id=project_id, is_active=True, deleted_at__isnull=True)
        require_project_admin(request.user, project_id, request=request)
        membership_id = request.data.get('membership_id')
        membership = get_object_or_404(ProjectMembership, id=membership_id, project_id=project_id)
        if membership.user_id == request.user.id:
            return api_error_response(
                code='self_removal_forbidden',
                detail='You cannot remove yourself from the project here.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        membership.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectInvitationView(APIView):
    """Create and list project invitations."""

    def get(self, request, project_id: int):
        get_object_or_404(Project, id=project_id, is_active=True, deleted_at__isnull=True)
        require_project_admin(request.user, project_id, request=request)
        invitations = ProjectInvitation.objects.filter(project_id=project_id).order_by('-created_at')
        return Response(ProjectInvitationSerializer(invitations, many=True).data)

    def post(self, request, project_id: int):
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        require_project_admin(request.user, project_id, request=request)
        serializer = ProjectInvitationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = get_object_or_404(Project, id=project_id, is_active=True, deleted_at__isnull=True)

        try:
            result = create_or_resend_invitation(
                project=project,
                invited_by=request.user,
                email=serializer.validated_data['email'],
                role=serializer.validated_data['role'],
            )
        except InvitationFlowError as exc:
            return _invitation_error_response(exc)

        invitation = result.invitation
        if invitation is None:
            return api_error_response(
                code='invitation_error',
                detail='Invitation could not be created.',
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        invite_link = build_public_frontend_url(f'/invite/accept?token={invitation.token}')
        mail_sent, mail_error = _send_project_invitation_email(
            invitation=invitation,
            project_name=project.name,
            invited_by=request.user,
        )

        payload = ProjectInvitationSerializer(invitation).data
        payload['code'] = result.code
        payload['mail_sent'] = mail_sent
        payload['invite_link'] = invite_link
        if not mail_sent and mail_error:
            payload['mail_error'] = mail_error
            payload['mail_error_code'] = 'email_send_failed'
        status_code = status.HTTP_201_CREATED if result.code == 'invitation_sent' else status.HTTP_200_OK
        return Response(payload, status=status_code)


class PublicProjectInvitationView(APIView):
    """Read public invitation status by token."""

    permission_classes = [permissions.AllowAny]

    def get(self, request, token: str):
        try:
            invitation = get_invitation_by_token(token)
        except InvitationFlowError as exc:
            return api_error_response(code=exc.code, detail=exc.message, status_code=status.HTTP_404_NOT_FOUND)

        if request.user.is_authenticated:
            clear_pending_invitation_token(session=request.session)
        elif invitation.is_open:
            store_pending_invitation_token(session=request.session, token=invitation.token)
        else:
            clear_pending_invitation_token(session=request.session)

        payload = build_public_status(invitation, request.user if request.user.is_authenticated else None)
        return Response(payload)


class PendingProjectInvitationView(APIView):
    """Read or clear the pending invitation token kept in the current session."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        token = get_pending_invitation_token(session=request.session)
        if token is None:
            return Response({'code': 'no_pending_invitation', 'requires_auth': not request.user.is_authenticated})

        try:
            invitation = get_invitation_by_token(token)
        except InvitationFlowError as exc:
            clear_pending_invitation_token(session=request.session)
            return _invitation_error_response(exc)

        payload = build_public_status(invitation, request.user if request.user.is_authenticated else None)
        return Response(payload)

    def delete(self, request):
        clear_pending_invitation_token(session=request.session)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AcceptProjectInvitationByTokenView(APIView):
    """Accept invitation by token path parameter."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'invitation_accept'

    def post(self, request, token: str):
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        logger.info('Invitation accept endpoint reached', extra={'user_id': request.user.id, 'path': request.path})
        try:
            invitation = get_invitation_by_token(token)
            result = accept_invitation(invitation=invitation, user=request.user)
        except InvitationFlowError as exc:
            logger.warning('Invitation accept failed', extra={'user_id': request.user.id, 'code': exc.code, 'path': request.path})
            return _invitation_error_response(exc)

        project_payload = _apply_invitation_project_settings(user=request.user, project=result.invitation.project)
        clear_pending_invitation_token(session=request.session)

        return Response(
            {
                'code': result.code,
                'detail': result.message,
                'project_id': result.invitation.project_id if result.invitation else None,
                'project': project_payload,
            }
        )


class AcceptProjectInvitationView(APIView):
    """Accept invitation token from request body for backward compatibility."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'invitation_accept'

    def post(self, request):
        serializer = InvitationTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.validated_data['token']
        logger.info('Invitation accept body endpoint reached', extra={'user_id': request.user.id, 'path': request.path})
        return AcceptProjectInvitationByTokenView().post(request, token)


class AcceptPendingProjectInvitationView(APIView):
    """Accept the invitation token currently stored in the session."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'invitation_accept'

    def post(self, request):
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        logger.info('Pending invitation accept endpoint reached', extra={'user_id': request.user.id, 'path': request.path})
        try:
            result = accept_pending_invitation_from_session(session=request.session, user=request.user)
        except InvitationFlowError as exc:
            if exc.code == 'no_pending_invitation':
                return Response(
                    {
                        'code': exc.code,
                        'detail': exc.message,
                        'project_id': None,
                        'project': None,
                    }
                )
            logger.warning('Pending invitation accept failed', extra={'user_id': request.user.id, 'code': exc.code, 'path': request.path})
            return _invitation_error_response(exc)

        project_payload = _apply_invitation_project_settings(user=request.user, project=result.invitation.project)
        clear_pending_invitation_token(session=request.session)

        return Response(
            {
                'code': result.code,
                'detail': result.message,
                'project_id': result.invitation.project_id if result.invitation else None,
                'project': project_payload,
            }
        )


class RevokeProjectInvitationView(APIView):
    """Revoke open invitations as project admin."""

    def post(self, request, project_id: int, invitation_id: int):
        get_object_or_404(Project, id=project_id, is_active=True, deleted_at__isnull=True)
        require_project_admin(request.user, project_id, request=request)
        invitation = get_object_or_404(ProjectInvitation, id=invitation_id, project_id=project_id)
        result = revoke_invitation(invitation=invitation, actor=request.user)
        return Response({'code': result.code, 'detail': result.message})
