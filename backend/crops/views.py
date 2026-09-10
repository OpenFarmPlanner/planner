"""
Read-only crop library API. Intentionally requires authentication only
(`IsAuthenticated`, the same DRF default every other endpoint in this
project uses) and does no project scoping at all — a published crop
belongs to the library, not to any one project.

This mirrors `farm.crops.views.PublicCropViewSet` (which keeps serving
`/api/public-crops/` unchanged for the current frontend) rather than
replacing it, so this is purely additive: a new, forward-looking surface
at `/api/crop-library/` that can later be made genuinely public (e.g. by
swapping the permission class) without touching anything that already
works. See docs/crop-library-architecture.md.
"""
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from config.responses import api_error_response

from accounts.demo_access import guest_demo_forbidden_response, is_active_guest_demo_user
from config.languages import REQUIRED_PUBLIC_CROP_SPECIES_LANGUAGE_CODES

from . import services
from .models import CropSpecies, PublicLibraryModeratorRequest
from .permissions import (
    grant_public_library_moderator_access,
    is_public_library_admin,
    is_public_library_moderator,
)
from .serializers import (
    CropSerializer,
    CropSpeciesSerializer,
    CropSpeciesTranslationSerializer,
    PublicLibraryModeratorRequestSerializer,
)


def _translation_payload_by_language(data) -> dict[str, dict]:
    serializer = CropSpeciesTranslationSerializer(data=data or [], many=True)
    serializer.is_valid(raise_exception=True)
    return {
        item['language_code']: item
        for item in serializer.validated_data
    }


class CropSpeciesViewSet(viewsets.ModelViewSet):
    """Official crop species list plus lightweight user proposals."""

    serializer_class = CropSpeciesSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = CropSpecies.objects.select_related(
            'proposed_by__public_profile',
            'reviewed_by__public_profile',
        # Every serialized row renders the full `translations` list and
        # resolves `display_name`/`display_language_code` through
        # `localized_name`; without the prefetch that is three queries per
        # species on a page that holds up to PAGE_SIZE of them.
        ).prefetch_related('translations').order_by('name')
        include_proposed = (
            self.request.query_params.get('include_proposed') in {'1', 'true', 'True'}
        )
        status_filter = (self.request.query_params.get('status') or '').strip()
        can_review = is_public_library_moderator(self.request.user)
        if not can_review:
            queryset = services.public_species_mapping_targets(queryset)
        elif status_filter:
            queryset = queryset.filter(status=status_filter)
        elif not include_proposed:
            queryset = queryset.filter(status=CropSpecies.STATUS_PUBLISHED)
        query = (self.request.query_params.get('q') or '').strip()
        if query:
            queryset = queryset.filter(services.build_species_search_query(query)).distinct()
        return queryset

    def create(self, request, *args, **kwargs):
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        species = serializer.save(status=CropSpecies.STATUS_PROPOSED, proposed_by=request.user)
        services.notify_moderators_of_species_proposal(species)
        return Response(self.get_serializer(species).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        if not is_public_library_moderator(request.user):
            return self._moderator_required_response()
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not is_public_library_moderator(request.user):
            return self._moderator_required_response()
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not is_public_library_moderator(request.user):
            return self._moderator_required_response()
        return super().destroy(request, *args, **kwargs)

    @staticmethod
    def _moderator_required_response() -> Response:
        return api_error_response(
            code='moderator_required',
            detail='Moderator privileges are required.',
            status_code=status.HTTP_403_FORBIDDEN,
        )

    @staticmethod
    def _proposal_status_error() -> Response:
        return api_error_response(
            code='proposal_not_pending',
            detail='Only pending crop species proposals can be reviewed.',
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        if not is_public_library_moderator(request.user):
            return self._moderator_required_response()
        review_note = (request.data.get('review_note') or '').strip()
        with transaction.atomic():
            species = (
                CropSpecies.objects
                .select_for_update()
                .prefetch_related('translations')
                .get(pk=pk)
            )
            if not species.is_pending:
                return self._proposal_status_error()
            translation_payload = _translation_payload_by_language(request.data.get('translations'))
            existing_translations = {
                translation.language_code: {
                    'language_code': translation.language_code,
                    'common_name': translation.common_name,
                    'synonyms': translation.synonyms,
                    'regional_names': translation.regional_names,
                }
                for translation in species.translations.all()
            }
            approved_translations = {**existing_translations, **translation_payload}
            missing_languages = [
                code
                for code in REQUIRED_PUBLIC_CROP_SPECIES_LANGUAGE_CODES
                if not (approved_translations.get(code, {}).get('common_name') or '').strip()
            ]
            if missing_languages:
                return Response(
                    {
                        'detail': 'Required crop species translations are missing.',
                        'code': 'missing_required_translations',
                        'missing_languages': missing_languages,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            from farm.utils import normalize_text

            identity_queries = [
                services.build_exact_species_identity_query(normalize_text(item['common_name']) or '')
                for item in approved_translations.values()
                if (item.get('common_name') or '').strip()
            ]
            duplicate_query = identity_queries[0] if identity_queries else services.build_exact_species_identity_query(species.name_normalized)
            for query in identity_queries[1:]:
                duplicate_query |= query
            duplicate = CropSpecies.objects.filter(
                status=CropSpecies.STATUS_PUBLISHED,
            ).filter(duplicate_query).exclude(pk=species.pk).first()
            if duplicate is not None:
                return Response(
                    {
                        'detail': 'A published crop species with this name already exists.',
                        'code': 'duplicate_crop_species',
                        'duplicate': {'id': duplicate.id, 'name': duplicate.name},
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            CropSpeciesSerializer._write_translations(species, list(approved_translations.values()))
            if hasattr(species, '_prefetched_objects_cache'):
                species._prefetched_objects_cache = {}
            species.name = approved_translations['en']['common_name']
            species.status = CropSpecies.STATUS_PUBLISHED
            species.reviewed_by = request.user
            species.reviewed_at = timezone.now()
            species.review_note = review_note
            species.save(update_fields=['name', 'name_normalized', 'status', 'reviewed_by', 'reviewed_at', 'review_note'])
        services.notify_species_proposal_reviewed(species)
        return Response(self.get_serializer(species).data)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        if not is_public_library_moderator(request.user):
            return self._moderator_required_response()
        review_note = (request.data.get('review_note') or '').strip()
        with transaction.atomic():
            species = CropSpecies.objects.select_for_update().get(pk=pk)
            if not species.is_pending:
                return self._proposal_status_error()
            species.status = CropSpecies.STATUS_REJECTED
            species.reviewed_by = request.user
            species.reviewed_at = timezone.now()
            species.review_note = review_note
            species.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_note'])
            services.remove_public_crops_for_rejected_species(species, request.user)
        services.notify_species_proposal_reviewed(species)
        return Response(self.get_serializer(species).data)


class PublicLibraryModeratorRequestViewSet(viewsets.ModelViewSet):
    """Moderator access requests for the public crop library."""

    serializer_class = PublicLibraryModeratorRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = PublicLibraryModeratorRequest.objects.select_related(
            'user__public_profile',
            'reviewed_by__public_profile',
        )
        if is_public_library_admin(self.request.user):
            status_filter = (self.request.query_params.get('status') or '').strip()
            return queryset.filter(status=status_filter) if status_filter else queryset
        return queryset.filter(user=self.request.user)

    def list(self, request, *args, **kwargs):
        if not is_public_library_admin(request.user):
            return api_error_response(
                code='admin_required',
                detail='Administrator privileges are required.',
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        if is_public_library_moderator(request.user):
            return api_error_response(
                code='already_moderator',
                detail='This account already has moderator privileges.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if PublicLibraryModeratorRequest.objects.filter(
            user=request.user,
            status=PublicLibraryModeratorRequest.STATUS_PENDING,
        ).exists():
            return api_error_response(
                code='moderator_request_pending',
                detail='A moderator request is already pending.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_row = serializer.save(user=request.user)
        services.notify_admins_of_moderator_request(request_row)
        return Response(self.get_serializer(request_row).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='mine')
    def mine(self, request):
        latest_request = (
            PublicLibraryModeratorRequest.objects
            .filter(user=request.user)
            .order_by('-created_at')
            .first()
        )
        return Response({
            'is_moderator': is_public_library_moderator(request.user),
            'request': (
                self.get_serializer(latest_request).data
                if latest_request is not None
                else None
            ),
        })

    @staticmethod
    def _admin_required_response() -> Response:
        return api_error_response(
            code='admin_required',
            detail='Administrator privileges are required.',
            status_code=status.HTTP_403_FORBIDDEN,
        )

    @staticmethod
    def _request_status_error() -> Response:
        return api_error_response(
            code='moderator_request_not_pending',
            detail='Only pending moderator requests can be reviewed.',
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        if not is_public_library_admin(request.user):
            return self._admin_required_response()
        review_note = (request.data.get('review_note') or '').strip()
        with transaction.atomic():
            moderator_request = (
                PublicLibraryModeratorRequest.objects
                .select_for_update()
                .select_related('user')
                .get(pk=pk)
            )
            if moderator_request.status != PublicLibraryModeratorRequest.STATUS_PENDING:
                return self._request_status_error()
            grant_public_library_moderator_access(moderator_request.user)
            moderator_request.status = PublicLibraryModeratorRequest.STATUS_APPROVED
            moderator_request.reviewed_by = request.user
            moderator_request.reviewed_at = timezone.now()
            moderator_request.review_note = review_note
            moderator_request.save(update_fields=[
                'status',
                'reviewed_by',
                'reviewed_at',
                'review_note',
                'updated_at',
            ])
        return Response(self.get_serializer(moderator_request).data)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        if not is_public_library_admin(request.user):
            return self._admin_required_response()
        moderator_request = self.get_object()
        if moderator_request.status != PublicLibraryModeratorRequest.STATUS_PENDING:
            return self._request_status_error()
        moderator_request.status = PublicLibraryModeratorRequest.STATUS_REJECTED
        moderator_request.reviewed_by = request.user
        moderator_request.reviewed_at = timezone.now()
        moderator_request.review_note = (request.data.get('review_note') or '').strip()
        moderator_request.save(update_fields=[
            'status',
            'reviewed_by',
            'reviewed_at',
            'review_note',
            'updated_at',
        ])
        return Response(self.get_serializer(moderator_request).data)


class CropViewSet(viewsets.ReadOnlyModelViewSet):
    """Published crops: list/retrieve, plus an exact-match lookup."""

    serializer_class = CropSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        params = self.request.query_params
        return services.list_published_crops(
            query=params.get('q') or '',
            name=params.get('name') or '',
            variety=params.get('variety') or '',
        )

    @action(detail=False, methods=['get'], url_path='match')
    def match(self, request):
        crop = services.find_exact_crop_match(
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
