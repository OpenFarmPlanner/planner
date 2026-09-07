from __future__ import annotations

from datetime import timedelta
import logging

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.tokens import default_token_generator
from django.db import IntegrityError
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone, translation
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import permissions, serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.languages import UI_LANGUAGE_AUTO
from farm.services.demo_project import resolve_demo_request_language

from .consent import record_acceptance
from .data_export import build_personal_data_export
from .demo_access import guest_demo_forbidden_response, is_active_guest_demo_user
from .emails import (
    _send_activation_email,
    _send_email_change_confirmation_email,
    _send_password_reset_email,
    _uses_local_non_delivery_email_backend,
)
from .guest_demo import create_guest_demo_session, delete_guest_demo_session
from .services import (
    _clear_activation_expiry,
    _decode_uid,
    _logout_all_user_sessions,
    _normalize_email,
    _set_activation_expiry,
    _validate_serializer_in_german,
    record_verified_email as _record_verified_email,
)
from .models import (
    AccountDeletionRequest,
    AccountEmailChangeRequest,
    GuestDemoSession,
    PendingActivation,
    PublicProfile,
    UserProjectSettings,
)
from .serializers import (
    AccountEmailChangeConfirmSerializer,
    AccountLanguageSerializer,
    AccountEmailChangeRequestSerializer,
    AccountDeleteRequestSerializer,
    AccountPasswordChangeSerializer,
    AccountProfileSerializer,
    AccountPublicProfileSerializer,
    AccountRestoreSerializer,
    ActivateSerializer,
    ConsentAcceptSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    ResendActivationSerializer,
    UserSerializer,
)

User = get_user_model()
ACCOUNT_DELETION_GRACE_DAYS = 14
logger = logging.getLogger(__name__)


def _de(message: str) -> str:
    with translation.override('de'):
        return _(message)


GENERIC_EMAIL_SENT_MESSAGE = _de('If the account exists, an email has been sent.')
REGISTRATION_EMAIL_SENT_MESSAGE = _de('Registration successful. Please check your email to activate your account.')
REGISTRATION_LOCAL_EMAIL_MESSAGE = _de(
    'Registration successful. In local development, the activation email is written to the server log/terminal and is not delivered to an inbox.'
)
REGISTRATION_EMAIL_SEND_FAILED_MESSAGE = (
    f'Dein Konto wurde erstellt, aber die Aktivierungs-E-Mail konnte nicht gesendet werden. '
    f'Bitte kontaktiere [{settings.SUPPORT_CONTACT_EMAIL}](mailto:{settings.SUPPORT_CONTACT_EMAIL}), '
    'damit wir dein Konto aktivieren oder dir den Link erneut senden können.'
)
GENERIC_EMAIL_SEND_FAILED_MESSAGE = (
    f'Die E-Mail konnte nicht gesendet werden. '
    f'Bitte kontaktiere [{settings.SUPPORT_CONTACT_EMAIL}](mailto:{settings.SUPPORT_CONTACT_EMAIL}).'
)
EMAIL_CHANGE_CONFIRMATION_SENT_MESSAGE = _de(
    'Wir haben dir einen Bestätigungslink an die neue E-Mail-Adresse gesendet. '
    'Deine aktuelle Login-E-Mail bleibt aktiv, bis du den Link bestätigst.'
)
EMAIL_CHANGE_CONFIRMATION_SUCCESS_MESSAGE = _de('Deine E-Mail-Adresse wurde erfolgreich aktualisiert.')
EMAIL_CHANGE_INVALID_LINK_MESSAGE = _de('Der Bestätigungslink ist ungültig oder abgelaufen.')
PASSWORD_UPDATED_MESSAGE = _de('Dein Passwort wurde erfolgreich geändert.')
PROFILE_UPDATED_MESSAGE = _de('Dein Profil wurde erfolgreich gespeichert.')


def _password_confirmation_is_valid(user: User, password: str) -> bool:
    """Confirm a sensitive account action with the account password.

    Accounts created through Google/Microsoft have no usable password, so
    there is nothing to re-enter; the authenticated session is the only
    confirmation available for them. Accounts that do have a password must
    still provide it.
    """
    if not user.has_usable_password():
        return True
    return user.check_password(password)


def _registration_success_message() -> str:
    return REGISTRATION_LOCAL_EMAIL_MESSAGE if _uses_local_non_delivery_email_backend() else REGISTRATION_EMAIL_SENT_MESSAGE


@method_decorator(ensure_csrf_cookie, name='dispatch')
class CsrfTokenView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request: Request) -> Response:
        return Response({'detail': _de(_('CSRF cookie set'))})


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth_register'

    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        _validate_serializer_in_german(serializer)
        user = serializer.save()
        _set_activation_expiry(user)
        try:
            _send_activation_email(user)
        except Exception:  # noqa: BLE001
            logger.exception(
                'Failed to send activation email after registration',
                extra={'user_id': user.id},
            )
            return Response(
                {
                    'code': 'email_send_failed',
                    'message': REGISTRATION_EMAIL_SEND_FAILED_MESSAGE,
                    'detail': REGISTRATION_EMAIL_SEND_FAILED_MESSAGE,
                },
                status=status.HTTP_201_CREATED,
            )
        detail_message = _registration_success_message()
        return Response({'detail': detail_message}, status=status.HTTP_201_CREATED)


class ActivateView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth_activation'

    def post(self, request: Request) -> Response:
        serializer = ActivateSerializer(data=request.data)
        _validate_serializer_in_german(serializer)
        uid = _decode_uid(serializer.validated_data['uid'])
        if uid is None:
            return Response({'detail': _de(_('Invalid activation link.'))}, status=status.HTTP_400_BAD_REQUEST)

        user = get_object_or_404(User, pk=uid)
        pending = PendingActivation.objects.filter(user=user).first()
        if pending is not None and pending.activation_expires_at < timezone.now():
            user.delete()
            return Response({'detail': _de(_('Invalid or expired activation token.'))}, status=status.HTTP_400_BAD_REQUEST)

        token = serializer.validated_data['token']
        if not default_token_generator.check_token(user, token):
            return Response({'detail': _de(_('Invalid or expired activation token.'))}, status=status.HTTP_400_BAD_REQUEST)

        user.is_active = True
        user.save(update_fields=['is_active'])
        _clear_activation_expiry(user)
        _record_verified_email(user, user.email)
        login(request, user)
        return Response(UserSerializer(user).data)


class GuestDemoStartView(APIView):
    """Start an isolated, anonymous demo session."""

    permission_classes = [permissions.AllowAny]
    throttle_scope = 'guest_demo_start'

    def post(self, request: Request) -> Response:
        existing_guest_demo = (
            GuestDemoSession.objects.filter(user=request.user).first()
            if request.user.is_authenticated
            else None
        )
        if request.user.is_authenticated:
            logout(request)
        if existing_guest_demo is not None:
            delete_guest_demo_session(existing_guest_demo)
        demo_session = create_guest_demo_session(language_code=resolve_demo_request_language(request))
        login(request, demo_session.user)
        request.session['guest_demo_session_id'] = demo_session.id
        return Response(UserSerializer(demo_session.user).data, status=status.HTTP_201_CREATED)


class GuestDemoEndView(APIView):
    """End the current guest session and delete its temporary data."""

    def post(self, request: Request) -> Response:
        demo_id = request.session.get('guest_demo_session_id')
        demo_session = GuestDemoSession.objects.filter(id=demo_id, user=request.user).first()
        if demo_session is None:
            demo_session = GuestDemoSession.objects.filter(user=request.user).first()
        logout(request)
        if demo_session is not None:
            delete_guest_demo_session(demo_session)
        return Response(status=status.HTTP_204_NO_CONTENT)


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth_login'

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        _validate_serializer_in_german(serializer)

        email = _normalize_email(serializer.validated_data['email'])
        password = serializer.validated_data['password']

        user = User.objects.filter(email__iexact=email).first()
        if user is None or not user.check_password(password):
            return Response({'detail': _de(_('Invalid credentials.'))}, status=status.HTTP_401_UNAUTHORIZED)

        deletion = AccountDeletionRequest.objects.filter(user=user).first()
        if deletion and deletion.is_pending and deletion.scheduled_deletion_at is not None and deletion.scheduled_deletion_at > timezone.now():
            return Response(
                {
                    'detail': _de(_('This account is pending deletion. You can still restore it.')),
                    'code': 'account_pending_deletion',
                    'scheduled_deletion_at': deletion.scheduled_deletion_at.isoformat(),
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if not user.is_active:
            return Response({'detail': _de(_('Account is not activated yet.'))}, status=status.HTTP_403_FORBIDDEN)

        login(request, user)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    def post(self, request: Request) -> Response:
        logout(request)
        return Response({'detail': _de(_('Logged out.'))})


class MeView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request: Request) -> Response:
        if not request.user.is_authenticated:
            return Response({'detail': _de(_('Authentication credentials were not provided.'))}, status=status.HTTP_401_UNAUTHORIZED)
        return Response(UserSerializer(request.user).data)


class ConsentAcceptView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        serializer = ConsentAcceptSerializer(data=request.data)
        _validate_serializer_in_german(serializer)
        record_acceptance(request.user, serializer.validated_data['document'])
        return Response(UserSerializer(request.user).data)


class AccountProfileView(APIView):
    def patch(self, request: Request) -> Response:
        serializer = AccountProfileSerializer(data=request.data)
        _validate_serializer_in_german(serializer)
        display_name = serializer.validated_data['display_name'].strip()
        request.user.first_name = display_name
        request.user.save(update_fields=['first_name'])
        return Response({'detail': PROFILE_UPDATED_MESSAGE, 'user': UserSerializer(request.user).data})


class AccountPublicProfileView(APIView):
    def patch(self, request: Request) -> Response:
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        serializer = AccountPublicProfileSerializer(data=request.data, context={'request': request})
        _validate_serializer_in_german(serializer)
        public_display_name = serializer.validated_data['public_display_name'].strip()
        try:
            PublicProfile.objects.update_or_create(user=request.user, defaults={'public_display_name': public_display_name})
        except IntegrityError:
            raise serializers.ValidationError({'public_display_name': ['Dieser Name wird bereits verwendet.']})
        return Response({'detail': PROFILE_UPDATED_MESSAGE, 'user': UserSerializer(request.user).data})


class AccountLanguageView(APIView):
    """Reads and stores the signed-in user's personal UI language preference.

    Deliberately a user-level setting and not a project setting: members of the
    same project must be able to use it in different languages at once.
    """

    # Stated explicitly rather than relying on the project-wide default: this
    # endpoint writes to the user's stored settings, so it must never be
    # reachable anonymously even if that default changes.
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        settings_row = getattr(request.user, 'project_settings', None)
        return Response({
            'ui_language': getattr(settings_row, 'ui_language', UI_LANGUAGE_AUTO) or UI_LANGUAGE_AUTO,
        })

    def put(self, request: Request) -> Response:
        serializer = AccountLanguageSerializer(data=request.data)
        _validate_serializer_in_german(serializer)
        ui_language = serializer.validated_data['ui_language']
        UserProjectSettings.objects.update_or_create(
            user=request.user,
            defaults={'ui_language': ui_language},
        )
        request.user.refresh_from_db()
        return Response({'ui_language': ui_language, 'user': UserSerializer(request.user).data})


class AccountEmailChangeRequestView(APIView):
    throttle_scope = 'auth_password_reset_request'

    def post(self, request: Request) -> Response:
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        serializer = AccountEmailChangeRequestSerializer(data=request.data, context={'request': request})
        _validate_serializer_in_german(serializer)

        if not _password_confirmation_is_valid(request.user, serializer.validated_data.get('current_password', '')):
            return Response({'detail': _de(_('Invalid password.'))}, status=status.HTTP_400_BAD_REQUEST)

        AccountEmailChangeRequest.objects.filter(user=request.user, confirmed_at__isnull=True).delete()
        email_change_request = AccountEmailChangeRequest.objects.create(
            user=request.user,
            new_email=serializer.validated_data['new_email'],
            expires_at=timezone.now() + timedelta(hours=24),
        )

        try:
            _send_email_change_confirmation_email(request.user, email_change_request)
        except Exception:  # noqa: BLE001
            logger.exception(
                'Failed to send email change confirmation',
                extra={'user_id': request.user.id, 'email_change_request_id': email_change_request.id},
            )
            email_change_request.delete()
            return Response(
                {
                    'code': 'email_send_failed',
                    'message': GENERIC_EMAIL_SEND_FAILED_MESSAGE,
                    'detail': GENERIC_EMAIL_SEND_FAILED_MESSAGE,
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response({'detail': EMAIL_CHANGE_CONFIRMATION_SENT_MESSAGE})


class AccountEmailChangeConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth_password_reset_confirm'

    def post(self, request: Request) -> Response:
        serializer = AccountEmailChangeConfirmSerializer(data=request.data)
        _validate_serializer_in_german(serializer)

        uid = _decode_uid(serializer.validated_data['uid'])
        if uid is None:
            return Response({'detail': EMAIL_CHANGE_INVALID_LINK_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(pk=uid, is_active=True).first()
        if user is None:
            return Response({'detail': EMAIL_CHANGE_INVALID_LINK_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)

        request_obj = AccountEmailChangeRequest.objects.filter(
            id=serializer.validated_data['request_id'],
            user=user,
            confirmed_at__isnull=True,
        ).first()
        if request_obj is None or request_obj.expires_at <= timezone.now():
            return Response({'detail': EMAIL_CHANGE_INVALID_LINK_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, serializer.validated_data['token']):
            return Response({'detail': EMAIL_CHANGE_INVALID_LINK_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(email__iexact=request_obj.new_email).exclude(pk=user.pk).exists():
            return Response({'detail': _de(_('An account with this email already exists.'))}, status=status.HTTP_400_BAD_REQUEST)

        user.email = request_obj.new_email
        user.save(update_fields=['email'])
        # The confirmation link was delivered to the new address, so it is
        # verified. Keeping the allauth record in sync keeps social account
        # linking (accounts.social_linking) working after an email change.
        _record_verified_email(user, request_obj.new_email)
        request_obj.confirmed_at = timezone.now()
        request_obj.save(update_fields=['confirmed_at', 'updated_at'])
        return Response({'detail': EMAIL_CHANGE_CONFIRMATION_SUCCESS_MESSAGE})


class AccountPasswordChangeView(APIView):
    def post(self, request: Request) -> Response:
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        serializer = AccountPasswordChangeSerializer(data=request.data, context={'request': request})
        _validate_serializer_in_german(serializer)

        if not request.user.check_password(serializer.validated_data['current_password']):
            return Response({'detail': _de(_('Invalid password.'))}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(serializer.validated_data['new_password'])
        request.user.save(update_fields=['password'])
        update_session_auth_hash(request, request.user)
        return Response({'detail': PASSWORD_UPDATED_MESSAGE})


class AccountDeleteRequestView(APIView):
    """Mark the authenticated account for delayed deletion after password confirmation."""

    def post(self, request: Request) -> Response:
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        serializer = AccountDeleteRequestSerializer(data=request.data)
        _validate_serializer_in_german(serializer)

        user = request.user
        if not _password_confirmation_is_valid(user, serializer.validated_data.get('password', '')):
            return Response({'detail': _de(_('Invalid password.'))}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        scheduled = now + timedelta(days=ACCOUNT_DELETION_GRACE_DAYS)
        deletion, created_flag = AccountDeletionRequest.objects.get_or_create(user=user)
        deletion.deletion_requested_at = now
        deletion.scheduled_deletion_at = scheduled
        deletion.save(update_fields=['deletion_requested_at', 'scheduled_deletion_at', 'updated_at'])

        user.is_active = False
        user.save(update_fields=['is_active'])

        logger.info(
            'Account deletion requested',
            extra={
                'account_deletion_event': 'requested',
                'account_deletion_request_id': deletion.pk,
                'user_id': user.pk,
                'deletion_requested_at': now.isoformat(),
                'scheduled_deletion_at': scheduled.isoformat(),
                'created_request': created_flag,
            },
        )

        logout(request)
        _logout_all_user_sessions(user.id)

        return Response(
            {
                'detail': _de(_('Your account was marked for deletion.')),
                'scheduled_deletion_at': scheduled.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


class AccountRestoreView(APIView):
    """Restore an account that is pending deletion within the grace period."""

    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        serializer = AccountRestoreSerializer(data=request.data)
        _validate_serializer_in_german(serializer)
        email = _normalize_email(serializer.validated_data['email'])
        password = serializer.validated_data['password']

        user = User.objects.filter(email__iexact=email).first()
        if user is None or not user.check_password(password):
            return Response({'detail': _de(_('Invalid credentials.'))}, status=status.HTTP_400_BAD_REQUEST)

        deletion = AccountDeletionRequest.objects.filter(user=user).first()
        if deletion is None or not deletion.is_pending or deletion.scheduled_deletion_at is None:
            return Response({'detail': _de(_('No restorable deletion request found.'))}, status=status.HTTP_400_BAD_REQUEST)

        if deletion.scheduled_deletion_at <= timezone.now():
            return Response({'detail': _de(_('The deletion grace period has expired.'))}, status=status.HTTP_400_BAD_REQUEST)

        deletion.clear_schedule()
        user.is_active = True
        user.save(update_fields=['is_active'])

        logger.info(
            'Account deletion restored',
            extra={
                'account_deletion_event': 'restored',
                'account_deletion_request_id': deletion.pk,
                'user_id': user.pk,
            },
        )

        login(request, user)
        return Response(UserSerializer(user).data)


class AccountStatusView(APIView):
    """Return deletion scheduling state for the authenticated account."""

    def get(self, request: Request) -> Response:
        deletion = AccountDeletionRequest.objects.filter(user=request.user).first()
        return Response(
            {
                'pending_deletion': bool(deletion and deletion.is_pending),
                'scheduled_deletion_at': deletion.scheduled_deletion_at.isoformat() if deletion and deletion.scheduled_deletion_at else None,
                'deleted_at': deletion.deleted_at.isoformat() if deletion and deletion.deleted_at else None,
            }
        )


class AccountDataExportView(APIView):
    """Return a structured JSON export of the authenticated user's data."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> JsonResponse:
        if is_active_guest_demo_user(request.user):
            forbidden = guest_demo_forbidden_response()
            return JsonResponse(forbidden.data, status=forbidden.status_code)
        payload = build_personal_data_export(request.user)
        response = JsonResponse(payload, json_dumps_params={'indent': 2})
        response['Content-Disposition'] = 'attachment; filename="openfarmplanner-data-export.json"'
        return response


class ResendActivationView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth_resend_activation'

    def post(self, request: Request) -> Response:
        serializer = ResendActivationSerializer(data=request.data)
        _validate_serializer_in_german(serializer)
        email = _normalize_email(serializer.validated_data['email'])

        user = User.objects.filter(email__iexact=email).first()
        if user is not None and not user.is_active:
            _set_activation_expiry(user)
            try:
                _send_activation_email(user)
            except Exception:  # noqa: BLE001
                logger.exception(
                    'Failed to resend activation email',
                    extra={'user_id': user.id},
                )
                return Response(
                    {
                        'code': 'email_send_failed',
                        'message': GENERIC_EMAIL_SEND_FAILED_MESSAGE,
                        'detail': GENERIC_EMAIL_SEND_FAILED_MESSAGE,
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )

        return Response({'detail': GENERIC_EMAIL_SENT_MESSAGE})


class PasswordResetRequestView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth_password_reset_request'

    def post(self, request: Request) -> Response:
        serializer = PasswordResetRequestSerializer(data=request.data)
        _validate_serializer_in_german(serializer)
        email = _normalize_email(serializer.validated_data['email'])

        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user is not None:
            try:
                _send_password_reset_email(user)
            except Exception:  # noqa: BLE001
                logger.exception(
                    'Failed to send password reset email',
                    extra={'user_id': user.id},
                )
                return Response(
                    {
                        'code': 'email_send_failed',
                        'message': GENERIC_EMAIL_SEND_FAILED_MESSAGE,
                        'detail': GENERIC_EMAIL_SEND_FAILED_MESSAGE,
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )

        return Response({'detail': GENERIC_EMAIL_SENT_MESSAGE})


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'auth_password_reset_confirm'

    def post(self, request: Request) -> Response:
        serializer = PasswordResetConfirmSerializer(data=request.data)
        _validate_serializer_in_german(serializer)
        uid = _decode_uid(serializer.validated_data['uid'])
        if uid is None:
            return Response({'detail': _de(_('Invalid reset link.'))}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(pk=uid, is_active=True).first()
        if user is None:
            return Response({'detail': _de(_('Invalid reset link.'))}, status=status.HTTP_400_BAD_REQUEST)

        token = serializer.validated_data['token']
        if not default_token_generator.check_token(user, token):
            return Response({'detail': _de(_('Invalid or expired reset token.'))}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(serializer.validated_data['password'])
        user.save(update_fields=['password'])
        return Response({'detail': _de(_('Password has been reset successfully.'))})
