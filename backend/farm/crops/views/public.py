"""Public crop library endpoints."""


from typing import Any

from django.db import transaction
from django.db.models import Count, Max, OuterRef, Prefetch, Q, Subquery
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.demo_access import guest_demo_forbidden_response, is_active_guest_demo_user
from crops import services as crop_services
from crops.permissions import is_public_library_moderator
from crops.services import build_public_crop_search_query, find_exact_crop_match
from farm.common.responses import api_error_response
from farm.models import (
    Crop,
    PublicCrop,
    PublicCropChangeProposal,
    PublicCropDiscussionComment,
    format_crop_display_name,
)
from farm.project_context import get_active_project_optional, get_active_project_or_400
from farm.services.public_crops import (
    PublicCropEditConflictError,
    PublicCropIdentityConflictError,
    PublicCropImportConfirmationRequiredError,
    PublicCropPermissionError,
    PublicCropRevisionNotFoundError,
    PublicCropStatusTransitionError,
    UnsupportedPublicCropFieldsError,
    hard_delete_public_crop,
    import_public_crop_into_project,
    reinstate_removed_public_crop,
    remove_public_crop,
    replace_public_crop_translations,
    restore_public_crop_version,
    update_public_crop_directly,
)

from ..serializers import (
    CropSerializer,
    PublicCropSerializer,
)
from ..serializers.public import (
    PublicCropChangeProposalSerializer,
    PublicCropDiscussionCommentSerializer,
    PublicCropDiscussionTopicSerializer,
    PublicCropRevertSerializer,
    PublicCropRevisionSerializer,
    PublicCropTranslationsUpdateSerializer,
    PublicCropUpdateSerializer,
)


class PublicCropViewSet(viewsets.ModelViewSet):
    """Public library for published crops with project import and direct edit actions.

    Candidate for extraction into a separate service consumed by OFP over an
    API (under discussion as of 2026-07). Keep edits on the public row and do
    not couple this API to project-scoped history.
    """

    queryset = (
        PublicCrop.objects
        .filter(status=PublicCrop.STATUS_PUBLISHED)
        .filter(crop_services.visible_public_crop_species_query())
        .order_by('name', 'variety')
    )
    serializer_class = PublicCropSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action in {'discussion_topics', 'topic_comments'} and self.request.method == 'GET':
            return [permissions.AllowAny()]
        return super().get_permissions()

    def get_queryset(self):
        """Published entries, searchable across every language.

        Free-text and name search span all species translations so a query in
        one language finds entries whose UI name is in another ("Tomato" finds
        "Tomate / Tomato"). Species translations and descriptions are
        prefetched because the serializer resolves a localized name and
        description for every row — without this, search would add one query
        per result.
        """
        status_param = (self.request.query_params.get('status') or '').strip()
        if status_param == PublicCrop.STATUS_REMOVED and is_public_library_moderator(self.request.user):
            # Removed entries are hidden from every other list/detail call (the
            # class-level queryset filters to published-only) so a moderator
            # can find something to restore without exposing removed content
            # to everyone else.
            base_queryset = PublicCrop.objects.filter(
                status=PublicCrop.STATUS_REMOVED,
            ).order_by('name', 'variety')
        else:
            base_queryset = super().get_queryset()
        queryset = (
            base_queryset
            .select_related('created_by__public_profile', 'crop_species')
            .prefetch_related('crop_species__translations', 'translations')
            .annotate(
                imported_crops_count=Count(
                    'imported_crops',
                    filter=Q(imported_crops__deleted_at__isnull=True),
                    distinct=True,
                ),
            )
        )
        active_project = get_active_project_optional(self.request)
        if active_project is not None:
            queryset = queryset.prefetch_related(
                Prefetch(
                    'imported_crops',
                    queryset=Crop.objects.filter(
                        project=active_project, deleted_at__isnull=True,
                    ).order_by('-id'),
                    to_attr='prefetched_project_crops',
                ),
            )
        query = (self.request.query_params.get('q') or '').strip()
        name = (self.request.query_params.get('name') or '').strip()
        variety = (self.request.query_params.get('variety') or '').strip()
        crop_species_param = (self.request.query_params.get('crop_species') or '').strip()

        if query:
            queryset = queryset.filter(build_public_crop_search_query(query)).distinct()
        if name:
            queryset = queryset.filter(build_public_crop_search_query(name, include_variety=False)).distinct()
        if variety:
            # Variety names are proper names — matched verbatim, not translated.
            queryset = queryset.filter(variety__icontains=variety)
        if crop_species_param:
            try:
                queryset = queryset.filter(crop_species_id=int(crop_species_param))
            except ValueError:
                queryset = queryset.none()
        return queryset

    def get_serializer_class(self):
        if self.action in {'update', 'partial_update'}:
            return PublicCropUpdateSerializer
        return super().get_serializer_class()

    def _get_public_crop_for_status_action(self) -> PublicCrop:
        return get_object_or_404(
            PublicCrop.objects.select_related('created_by'),
            pk=self.kwargs.get(self.lookup_url_kwarg or self.lookup_field),
        )

    @staticmethod
    def _transition_error_response(error: Exception, response_status: int) -> Response:
        code = getattr(error, 'code', 'invalid_status_transition')
        return Response({'detail': str(error), 'code': code}, status=response_status)

    @staticmethod
    def _is_moderator(user: Any) -> bool:
        return is_public_library_moderator(user)

    @staticmethod
    def _guest_demo_write_forbidden(request: Request) -> Response | None:
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        return None

    @staticmethod
    def _proposal_status_error() -> Response:
        return Response(
            {'detail': 'Only pending change proposals can be reviewed.', 'code': 'proposal_not_pending'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    @staticmethod
    def _crop_species_pending_forbidden(public_crop: PublicCrop) -> Response | None:
        """Block actions that treat an unreviewed species as settled reference data.

        Importing, updating and discussing an entry all imply its species is
        real; while the species is only `proposed`, the entry stays visible
        (its publisher needs it) but those actions wait for moderation. The UI
        disables the same three actions — this is the enforcement behind it.
        """
        species = public_crop.crop_species
        if species is None or not species.is_pending:
            return None
        return Response(
            {
                'detail': 'The crop species of this entry is still awaiting moderation.',
                'code': 'crop_species_pending',
            },
            status=status.HTTP_409_CONFLICT,
        )

    @staticmethod
    def _edit_conflict_response(error: PublicCropEditConflictError) -> Response:
        return Response(
            {
                'detail': str(error),
                'code': error.code,
                'current_version': error.current_version,
            },
            status=status.HTTP_409_CONFLICT,
        )

    def update(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        partial = kwargs.pop('partial', False)
        public_crop = self.get_object()
        serializer = PublicCropUpdateSerializer(public_crop, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        validated_data = dict(serializer.validated_data)
        base_version = validated_data.pop('base_version', None)
        try:
            updated = update_public_crop_directly(
                public_crop=public_crop,
                user=request.user,
                data=validated_data,
                base_version=base_version,
            )
        except PublicCropPermissionError as error:
            return self._transition_error_response(error, status.HTTP_403_FORBIDDEN)
        except PublicCropEditConflictError as error:
            return self._edit_conflict_response(error)
        except PublicCropIdentityConflictError as error:
            return Response({
                'detail': str(error),
                'code': error.code,
                'conflicting_public_crop_id': error.conflicting_public_crop.id,
            }, status=status.HTTP_409_CONFLICT)
        except UnsupportedPublicCropFieldsError as error:
            return api_error_response(code=error.code, detail=error.detail, status_code=status.HTTP_400_BAD_REQUEST)
        return Response(PublicCropSerializer(updated, context=self.get_serializer_context()).data)

    def partial_update(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        public_crop = self._get_public_crop_for_status_action()
        try:
            hard_delete_public_crop(public_crop=public_crop, user=request.user)
        except PublicCropPermissionError as error:
            return self._transition_error_response(error, status.HTTP_403_FORBIDDEN)
        except PublicCropStatusTransitionError as error:
            return self._transition_error_response(error, status.HTTP_409_CONFLICT)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'], url_path='match')
    def match(self, request):
        """Check whether this crop identity already exists in the library.

        Matching is language-independent: the supplied name is resolved to a
        species through every translation first, so looking up
        "Tomato + Moneymaker" finds an entry published as
        "Tomate + Moneymaker". Only if the name resolves to no species at all
        does this fall back to matching the stored name, for legacy entries.
        """
        crop = find_exact_crop_match(
            name=request.query_params.get('name'),
            variety=request.query_params.get('variety'),
        )
        if crop is None:
            return Response({'exists': False, 'crop': None})

        return Response({
            'exists': True,
            'crop': {
                'id': crop.id,
                'name': crop.name,
                'variety': crop.variety,
            },
        })

    @action(detail=True, methods=['get', 'put'], url_path='translations')
    def translations(self, request: Request, pk: int | None = None) -> Response:
        """Read or replace the per-language editorial text of one entry.

        GET always returns every language (editorial and moderation screens
        need them all, regardless of the caller's UI language). PUT accepts a
        ``{language_code: description}`` map and upserts it, so a single crop
        keeps one record with language sections instead of turning into two
        crops.
        """
        public_crop = self.get_object()
        if request.method == 'GET':
            return Response({
                'original_language_code': public_crop.original_language_code,
                'translations': public_crop.descriptions_by_language(),
                'crop_species_translations': (
                    public_crop.crop_species.translations_by_language()
                    if public_crop.crop_species is not None
                    else {}
                ),
            })

        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        serializer = PublicCropTranslationsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            updated = replace_public_crop_translations(
                public_crop=public_crop,
                user=request.user,
                descriptions=serializer.validated_data['translations'],
            )
        except PublicCropPermissionError as error:
            return api_error_response(code=error.code, detail=error.message, status_code=status.HTTP_403_FORBIDDEN)
        except PublicCropStatusTransitionError as error:
            return self._transition_error_response(error, status.HTTP_400_BAD_REQUEST)
        return Response({
            'original_language_code': updated.original_language_code,
            'translations': updated.descriptions_by_language(),
        })

    @action(detail=True, methods=['post'], url_path='import')
    def import_to_project(self, request, pk=None):
        public_crop = self.get_object()
        if (blocked := self._crop_species_pending_forbidden(public_crop)) is not None:
            return blocked
        request.active_project = get_active_project_or_400(request)
        mode = request.data.get('mode') or 'auto'
        try:
            imported, operation = import_public_crop_into_project(
                public_crop=public_crop,
                project=request.active_project,
                mode=mode,
            )
        except PublicCropImportConfirmationRequiredError as error:
            existing = error.existing_crop
            return Response({
                'code': error.code,
                'detail': str(error),
                'existing_crop_id': existing.id,
                'existing_crop_name': format_crop_display_name(existing.name, existing.variety),
                'variety_changed': (existing.variety or '') != (public_crop.variety or ''),
                'existing_variety': existing.variety,
                'public_variety': public_crop.variety,
            }, status=status.HTTP_409_CONFLICT)
        serializer = CropSerializer(imported, context={'request': request})
        response_status = status.HTTP_201_CREATED if operation == 'created' else status.HTTP_200_OK
        return Response({'crop': serializer.data, 'operation': operation}, status=response_status)

    @action(detail=True, methods=['get', 'post'], url_path='discussion-topics')
    def discussion_topics(self, request: Request, pk: int | None = None) -> Response:
        public_crop = self.get_object()
        if request.method == 'GET':
            latest_comment_body = PublicCropDiscussionComment.objects.filter(
                topic=OuterRef('pk'),
                deleted_at__isnull=True,
            ).order_by('-created_at', '-pk').values('body')[:1]
            topics = public_crop.discussion_topics.select_related(
                'created_by__public_profile', 'revision'
            ).annotate(
                comment_count=Count('comments', filter=Q(comments__deleted_at__isnull=True)),
                last_activity_at=Max('comments__created_at', filter=Q(comments__deleted_at__isnull=True)),
                last_comment_preview=Subquery(latest_comment_body),
            ).filter(comment_count__gt=0).order_by('-last_activity_at', '-created_at', '-pk')
            serializer = PublicCropDiscussionTopicSerializer(topics, many=True, context={'request': request})
            return Response(serializer.data)

        topic_serializer = PublicCropDiscussionTopicSerializer(data=request.data)
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        if (blocked := self._crop_species_pending_forbidden(public_crop)) is not None:
            return blocked
        topic_serializer.is_valid(raise_exception=True)
        comment_serializer = PublicCropDiscussionCommentSerializer(data={'body': request.data.get('body', '')})
        comment_serializer.is_valid(raise_exception=True)
        revision = topic_serializer.validated_data.get('revision')
        if revision and revision.public_crop_id != public_crop.id:
            return Response({'revision': ['The version does not belong to this public crop.']}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            topic = topic_serializer.save(public_crop=public_crop, created_by=request.user)
            comment_serializer.save(topic=topic, created_by=request.user)
        latest_comment_body = PublicCropDiscussionComment.objects.filter(
            topic=OuterRef('pk'),
            deleted_at__isnull=True,
        ).order_by('-created_at', '-pk').values('body')[:1]
        topic = public_crop.discussion_topics.select_related('created_by__public_profile', 'revision').annotate(
            comment_count=Count('comments', filter=Q(comments__deleted_at__isnull=True)),
            last_activity_at=Max('comments__created_at', filter=Q(comments__deleted_at__isnull=True)),
            last_comment_preview=Subquery(latest_comment_body),
        ).get(pk=topic.pk)
        return Response(PublicCropDiscussionTopicSerializer(topic, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'], url_path=r'discussion-topics/(?P<topic_id>[^/.]+)/comments')
    def topic_comments(self, request: Request, pk: int | None = None, topic_id: str | None = None) -> Response:
        public_crop = self.get_object()
        topic = get_object_or_404(public_crop.discussion_topics, pk=topic_id)
        if request.method == 'GET':
            comments = topic.comments.select_related('created_by__public_profile')
            root_comment_id = comments.order_by('created_at', 'id').values_list('id', flat=True).first()
            visible_reply_exists = (
                comments.filter(deleted_at__isnull=True).exclude(pk=root_comment_id).exists()
                if root_comment_id is not None
                else False
            )
            return Response(PublicCropDiscussionCommentSerializer(
                comments,
                many=True,
                context={
                    'request': request,
                    'root_comment_id': root_comment_id,
                    'visible_reply_exists': visible_reply_exists,
                },
            ).data)
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        if (blocked := self._crop_species_pending_forbidden(public_crop)) is not None:
            return blocked
        serializer = PublicCropDiscussionCommentSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        parent = serializer.validated_data.get('parent')
        if parent and parent.topic_id != topic.id:
            return Response({'parent': ['The parent comment does not belong to this topic.']}, status=status.HTTP_400_BAD_REQUEST)
        comment = serializer.save(topic=topic, created_by=request.user)
        return Response(PublicCropDiscussionCommentSerializer(comment, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'discussion-comments/(?P<comment_id>[^/.]+)')
    def discussion_comment(self, request: Request, pk: int | None = None, comment_id: str | None = None) -> Response:
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        public_crop = self.get_object()
        comment = get_object_or_404(PublicCropDiscussionComment.objects.select_related('topic'), pk=comment_id, topic__public_crop=public_crop)
        may_moderate = self._is_moderator(request.user)
        if comment.created_by_id != request.user.id and not may_moderate:
            return Response({'detail': 'You may only change your own comments.'}, status=status.HTTP_403_FORBIDDEN)
        if request.method == 'DELETE':
            root_comment_id = comment.topic.comments.order_by('created_at', 'id').values_list('id', flat=True).first()
            if comment.id == root_comment_id and not may_moderate:
                visible_reply_exists = comment.topic.comments.filter(deleted_at__isnull=True).exclude(pk=comment.id).exists()
                if visible_reply_exists:
                    return Response(
                        {
                            'detail': 'The opening post cannot be deleted while visible replies exist.',
                            'code': 'visible_replies_exist',
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
            if not comment.deleted_at:
                comment.body = ''
                comment.deleted_at = timezone.now()
                comment.deleted_by = request.user
                comment.save(update_fields=['body', 'deleted_at', 'deleted_by', 'updated_at'])
            return Response(status=status.HTTP_204_NO_CONTENT)
        if comment.deleted_at:
            return Response({'detail': 'Deleted comments cannot be edited.'}, status=status.HTTP_409_CONFLICT)
        serializer = PublicCropDiscussionCommentSerializer(comment, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save(edited_at=timezone.now())
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='versions')
    def versions(self, request: Request, pk: int | None = None) -> Response:
        public_crop = self.get_object()
        revisions = public_crop.revisions.select_related('created_by__public_profile')
        serializer = PublicCropRevisionSerializer(revisions, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='revert')
    def revert(self, request: Request, pk: int | None = None) -> Response:
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        public_crop = self.get_object()
        serializer = PublicCropRevertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            updated = restore_public_crop_version(
                public_crop=public_crop,
                user=request.user,
                version=serializer.validated_data['version'],
                base_version=serializer.validated_data.get('base_version'),
            )
        except PublicCropPermissionError as error:
            return self._transition_error_response(error, status.HTTP_403_FORBIDDEN)
        except PublicCropEditConflictError as error:
            return self._edit_conflict_response(error)
        except PublicCropRevisionNotFoundError as error:
            return api_error_response(code=error.code, detail=str(error), status_code=status.HTTP_404_NOT_FOUND)
        return Response(PublicCropSerializer(updated, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['get', 'post'], url_path='change-proposals')
    def change_proposals(self, request: Request, pk: int | None = None) -> Response:
        public_crop = self.get_object()
        if request.method == 'GET':
            proposals = public_crop.change_proposals.select_related('proposed_by__public_profile', 'reviewed_by__public_profile')
            serializer = PublicCropChangeProposalSerializer(proposals, many=True)
            return Response(serializer.data)

        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        serializer = PublicCropChangeProposalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = serializer.save(public_crop=public_crop, proposed_by=request.user)
        return Response(PublicCropChangeProposalSerializer(proposal).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path=r'change-proposals/(?P<proposal_id>[^/.]+)/approve')
    def approve_change_proposal(self, request: Request, pk: int | None = None, proposal_id: str | None = None) -> Response:
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        if not self._is_moderator(request.user):
            return api_error_response(code='moderator_required', detail='Moderator privileges are required.', status_code=status.HTTP_403_FORBIDDEN)

        public_crop = self.get_object()
        proposal = get_object_or_404(
            public_crop.change_proposals.select_related('proposed_by__public_profile', 'reviewed_by__public_profile'),
            pk=proposal_id,
        )
        if proposal.status != PublicCropChangeProposal.STATUS_PENDING:
            return self._proposal_status_error()

        review_note = (request.data.get('review_note') or '').strip()
        update_serializer = PublicCropUpdateSerializer(data=proposal.proposed_data, partial=True)
        update_serializer.is_valid(raise_exception=True)
        update_data = dict(update_serializer.validated_data)
        if 'seed_packages' in update_data:
            update_data['seed_packages'] = update_serializer.fields[
                'seed_packages'
            ].to_representation(update_data['seed_packages'])
        with transaction.atomic():
            update_public_crop_directly(
                public_crop=public_crop,
                user=request.user,
                data=update_data,
            )
            proposal.status = PublicCropChangeProposal.STATUS_APPROVED
            proposal.reviewed_by = request.user
            proposal.reviewed_at = timezone.now()
            proposal.review_note = review_note
            proposal.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'])

        return Response(PublicCropChangeProposalSerializer(proposal).data)

    @action(detail=True, methods=['post'], url_path=r'change-proposals/(?P<proposal_id>[^/.]+)/reject')
    def reject_change_proposal(self, request: Request, pk: int | None = None, proposal_id: str | None = None) -> Response:
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        if not self._is_moderator(request.user):
            return api_error_response(code='moderator_required', detail='Moderator privileges are required.', status_code=status.HTTP_403_FORBIDDEN)

        public_crop = self.get_object()
        proposal = get_object_or_404(
            public_crop.change_proposals.select_related('proposed_by__public_profile', 'reviewed_by__public_profile'),
            pk=proposal_id,
        )
        if proposal.status != PublicCropChangeProposal.STATUS_PENDING:
            return self._proposal_status_error()

        proposal.status = PublicCropChangeProposal.STATUS_REJECTED
        proposal.reviewed_by = request.user
        proposal.reviewed_at = timezone.now()
        proposal.review_note = (request.data.get('review_note') or '').strip()
        proposal.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'])
        return Response(PublicCropChangeProposalSerializer(proposal).data)

    @action(detail=True, methods=['post'], url_path='remove')
    def remove(self, request, pk=None):
        """Remove an entry from the public library (contributor withdrawal or moderator removal)."""
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        public_crop = self._get_public_crop_for_status_action()
        try:
            updated = remove_public_crop(
                public_crop=public_crop,
                user=request.user,
                reason=(request.data.get('reason') or '').strip(),
            )
        except PublicCropPermissionError as error:
            return self._transition_error_response(error, status.HTTP_403_FORBIDDEN)
        except PublicCropStatusTransitionError as error:
            return self._transition_error_response(error, status.HTTP_400_BAD_REQUEST)
        return Response(PublicCropSerializer(updated, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'], url_path='restore')
    def restore(self, request: Request, pk: str | None = None) -> Response:
        """Moderator-only: bring a removed (or withdrawn) entry back to published."""
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        public_crop = self._get_public_crop_for_status_action()
        try:
            updated = reinstate_removed_public_crop(public_crop=public_crop, user=request.user)
        except PublicCropPermissionError as error:
            return self._transition_error_response(error, status.HTTP_403_FORBIDDEN)
        except PublicCropStatusTransitionError as error:
            return self._transition_error_response(error, status.HTTP_400_BAD_REQUEST)
        return Response(PublicCropSerializer(updated, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'], url_path='hard-delete')
    def hard_delete(self, request, pk=None):
        if (forbidden := self._guest_demo_write_forbidden(request)) is not None:
            return forbidden
        public_crop = self._get_public_crop_for_status_action()
        try:
            hard_delete_public_crop(public_crop=public_crop, user=request.user)
        except PublicCropPermissionError as error:
            return self._transition_error_response(error, status.HTTP_403_FORBIDDEN)
        except PublicCropStatusTransitionError as error:
            return self._transition_error_response(error, status.HTTP_409_CONFLICT)
        return Response(status=status.HTTP_204_NO_CONTENT)
