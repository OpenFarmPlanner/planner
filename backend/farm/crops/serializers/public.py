"""Serializer for the public crop library."""

from typing import Any

from rest_framework import serializers

from config.languages import (
    DEFAULT_LANGUAGE_CODE,
    SUPPORTED_LANGUAGE_CODES,
    normalize_language_tag,
    resolve_request_language,
)
from crops.permissions import is_public_library_moderator
from farm.common.serializer_fields import CentimetersField, LocalizedDecimalField
from farm.models import (
    PublicCrop,
    PublicCropChangeProposal,
    PublicCropDiscussionComment,
    PublicCropDiscussionTopic,
    PublicCropRevision,
    SeedPackage,
    format_crop_display_name,
)
from farm.project_context import get_active_project_optional
from farm.services.public_crops import PUBLIC_CROP_EDITABLE_FIELDS

PUBLIC_CROP_PROPOSABLE_FIELDS = {
    'notes',
    'crop_family',
    'nutrient_demand',
    'cultivation_type',
    'cultivation_types',
    'growth_duration_days',
    'harvest_duration_days',
    'propagation_duration_days',
    'harvest_method',
    'expected_yield',
    'distance_within_row_m',
    'row_spacing_m',
    'sowing_depth_m',
    'seed_rate_value',
    'seed_rate_unit',
    'seed_rate_by_cultivation',
    'thousand_kernel_weight_g',
    'seeding_requirement',
    'seeding_requirement_type',
    'seed_packages',
}


class PublicCropSeedPackageSerializer(serializers.Serializer):
    """Validate one seed-package snapshot embedded in public library JSON."""

    size_value = serializers.FloatField(min_value=1e-12)
    size_unit = serializers.ChoiceField(choices=SeedPackage.UNIT_CHOICES)
    evidence_text = serializers.CharField(required=False, allow_blank=True, max_length=200)
    last_seen_at = serializers.DateTimeField(required=False, allow_null=True)

    def to_internal_value(self, data: Any) -> dict[str, Any]:
        if not isinstance(data, dict):
            return super().to_internal_value(data)
        unknown_fields = sorted(set(data) - set(self.fields))
        if unknown_fields:
            raise serializers.ValidationError(
                f"Unsupported seed package fields: {', '.join(unknown_fields)}",
            )
        return super().to_internal_value(data)


def get_public_user_label(user: Any) -> str:
    if user is None:
        return ''
    public_profile = getattr(user, 'public_profile', None)
    if public_profile and public_profile.public_display_name:
        return public_profile.public_display_name
    return ''


class PublicCropSerializer(serializers.ModelSerializer):
    """Public library entry, with both the resolved and the raw translations.

    ``display_name``/``description`` are what the app renders in the caller's
    language (after the standard fallback chain), while ``translations`` and
    ``crop_species_translations`` carry every stored language so editorial and
    moderation screens can edit any of them. ``variety``, supplier, spacings
    and every numeric field are language-independent and served verbatim.
    """

    created_by_label = serializers.SerializerMethodField()
    crop_species_name = serializers.SerializerMethodField()
    crop_species_canonical_name = serializers.CharField(
        source='crop_species.name',
        read_only=True,
        default='',
    )
    crop_species_translations = serializers.SerializerMethodField()
    crop_species_search_names = serializers.SerializerMethodField()
    # A `proposed` species is one a user suggested and no moderator has
    # reviewed yet. Entries published under it are usable but provisional, so
    # the UI marks them and blocks import/update/discussion until it is
    # reviewed — see docs/crop-library-architecture.md.
    crop_species_status = serializers.CharField(
        source='crop_species.status',
        read_only=True,
        default='',
    )
    display_name = serializers.SerializerMethodField()
    display_language_code = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    description_language_code = serializers.SerializerMethodField()
    translations = serializers.SerializerMethodField()
    project_import_status = serializers.SerializerMethodField()
    imported_crops_count = serializers.SerializerMethodField()
    distance_within_row_cm = CentimetersField(source='distance_within_row_m', read_only=True)
    row_spacing_cm = CentimetersField(source='row_spacing_m', read_only=True)
    sowing_depth_cm = CentimetersField(source='sowing_depth_m', read_only=True)
    seed_requirements = serializers.SerializerMethodField()
    seed_rate_direct_value = serializers.SerializerMethodField()
    seed_rate_direct_unit = serializers.SerializerMethodField()
    seed_rate_pre_cultivation_value = serializers.SerializerMethodField()
    seed_rate_pre_cultivation_unit = serializers.SerializerMethodField()
    thousand_kernel_weight_g = LocalizedDecimalField(
        max_digits=6,
        decimal_places=2,
        read_only=True,
        allow_null=True,
    )

    class Meta:
        model = PublicCrop
        fields = [
            'id',
            'status',
            'removal_reason',
            'name',
            'variety',
            'notes',
            'crop_species',
            'crop_species_name',
            'crop_species_canonical_name',
            'crop_species_translations',
            'crop_species_search_names',
            'crop_species_status',
            'display_name',
            'display_language_code',
            'description',
            'description_language_code',
            'translations',
            'original_language_code',
            'crop_family',
            'nutrient_demand',
            'cultivation_types',
            'cultivation_type',
            'growth_duration_days',
            'harvest_duration_days',
            'propagation_duration_days',
            'harvest_method',
            'expected_yield',
            'distance_within_row_m',
            'distance_within_row_cm',
            'row_spacing_m',
            'row_spacing_cm',
            'sowing_depth_m',
            'sowing_depth_cm',
            'seed_rate_value',
            'seed_rate_unit',
            'seed_rate_by_cultivation',
            'seed_requirements',
            'seed_rate_direct_value',
            'seed_rate_direct_unit',
            'seed_rate_pre_cultivation_value',
            'seed_rate_pre_cultivation_unit',
            'thousand_kernel_weight_g',
            'seeding_requirement',
            'seeding_requirement_type',
            'display_color',
            'seed_packages',
            'version',
            'published_at',
            'created_at',
            'updated_at',
            'created_by_label',
            'source_project_crop',
            'source_project',
            'project_import_status',
            'imported_crops_count',
        ]
        read_only_fields = fields

    def _seed_rate_for_method(self, obj: PublicCrop, method: str) -> dict[str, Any] | None:
        method_specific = (obj.seed_rate_by_cultivation or {}).get(method)
        if method_specific:
            return method_specific
        if obj.cultivation_type == method or method in (obj.cultivation_types or []):
            if obj.seed_rate_value is not None or obj.seed_rate_unit:
                return {
                    'value': obj.seed_rate_value,
                    'unit': obj.seed_rate_unit,
                }
        return None

    def get_seed_requirements(self, obj: PublicCrop) -> dict[str, dict[str, Any]]:
        requirements = {}
        for method in ('direct_sowing', 'pre_cultivation'):
            entry = self._seed_rate_for_method(obj, method)
            if entry and entry.get('value') is not None and entry.get('unit'):
                requirements[method] = {
                    'value': entry['value'],
                    'unit': entry['unit'],
                }
        return requirements

    def get_seed_rate_direct_value(self, obj: PublicCrop) -> float | None:
        entry = self._seed_rate_for_method(obj, 'direct_sowing')
        return entry.get('value') if entry else None

    def get_seed_rate_direct_unit(self, obj: PublicCrop) -> str | None:
        entry = self._seed_rate_for_method(obj, 'direct_sowing')
        return entry.get('unit') if entry else None

    def get_seed_rate_pre_cultivation_value(self, obj: PublicCrop) -> float | None:
        entry = self._seed_rate_for_method(obj, 'pre_cultivation')
        return entry.get('value') if entry else None

    def get_seed_rate_pre_cultivation_unit(self, obj: PublicCrop) -> str | None:
        entry = self._seed_rate_for_method(obj, 'pre_cultivation')
        return entry.get('unit') if entry else None

    def get_created_by_label(self, obj: PublicCrop) -> str:
        return obj.created_by_label

    def get_project_import_status(self, obj: PublicCrop) -> dict[str, Any] | None:
        """Whether the active project already imported this entry, for the import button state.

        Relies on the view prefetching ``prefetched_project_crops`` (the
        active project's Crops linked to this public entry via
        ``source_public_crop``) so this stays a single extra query for
        the whole list rather than one per row.
        """
        crops = getattr(obj, 'prefetched_project_crops', None)
        if not crops:
            return None
        crop = crops[0]
        return {
            'crop_id': crop.id,
            'crop_name': format_crop_display_name(crop.name, crop.variety),
            'is_modified_from_source': crop.is_modified_from_source,
        }

    def _language(self) -> str:
        request = self.context.get('request')
        return resolve_request_language(request) if request is not None else DEFAULT_LANGUAGE_CODE

    def _region(self) -> str:
        request = self.context.get('request')
        if request is None:
            return ''
        active_project = getattr(request, 'active_project', None)
        if active_project is None:
            active_project = get_active_project_optional(request)
        return getattr(active_project, 'region', '') if active_project is not None else ''

    def get_crop_species_name(self, obj: PublicCrop) -> str:
        """Species name in the caller's language; never empty, never an id."""
        return obj.display_name(self._language(), self._region())[0]

    def get_display_name(self, obj: PublicCrop) -> str:
        return obj.display_name(self._language(), self._region())[0]

    def get_display_language_code(self, obj: PublicCrop) -> str:
        """Language the name came from — '' means "no real translation exists"."""
        return obj.display_name(self._language(), self._region())[1]

    def get_description(self, obj: PublicCrop) -> str:
        return obj.localized_description(self._language())[0]

    def get_description_language_code(self, obj: PublicCrop) -> str | None:
        return obj.localized_description(self._language())[1]

    def get_translations(self, obj: PublicCrop) -> dict[str, str]:
        return obj.descriptions_by_language()

    def get_crop_species_translations(self, obj: PublicCrop) -> dict[str, str]:
        if obj.crop_species is None:
            return {}
        return obj.crop_species.translations_by_language()

    def get_crop_species_search_names(self, obj: PublicCrop) -> list[str]:
        if obj.crop_species is None:
            return []
        return obj.crop_species.search_names()

    def get_imported_crops_count(self, obj: PublicCrop) -> int:
        """How many project crops (across all projects) are linked to this entry.

        Shown to admins editing a public entry so a rename's blast radius is
        visible before saving. The list/retrieve queryset annotates this
        directly (a single JOIN, no per-row query); the fallback count only
        runs for objects built outside that queryset, such as the instance
        returned right after a direct edit.
        """
        annotated = getattr(obj, 'imported_crops_count', None)
        if annotated is not None:
            return annotated
        return obj.imported_crops.filter(deleted_at__isnull=True).count()


class PublicCropUpdateSerializer(serializers.ModelSerializer):
    base_version = serializers.IntegerField(required=False, min_value=1, write_only=True)
    seed_packages = PublicCropSeedPackageSerializer(many=True, required=False)

    class Meta:
        model = PublicCrop
        fields = [*PUBLIC_CROP_EDITABLE_FIELDS, 'base_version']
        extra_kwargs = {
            'notes': {'required': False, 'allow_blank': True},
            'crop_family': {'required': False, 'allow_blank': True},
            'nutrient_demand': {'required': False, 'allow_blank': True},
            'cultivation_type': {'required': False, 'allow_blank': True},
            'harvest_method': {'required': False, 'allow_blank': True},
            'seed_rate_unit': {'required': False, 'allow_null': True, 'allow_blank': True},
            'seeding_requirement_type': {'required': False, 'allow_blank': True},
            'display_color': {'required': False, 'allow_blank': True},
        }

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        incoming_fields = set(getattr(self, 'initial_data', {}) or {})
        allowed_fields = set(PUBLIC_CROP_EDITABLE_FIELDS) | {'base_version'}
        unknown_fields = sorted(incoming_fields - allowed_fields)
        if unknown_fields:
            raise serializers.ValidationError({
                'non_field_errors': [f"Unsupported public crop fields: {', '.join(unknown_fields)}"],
            })
        return attrs


class PublicCropTranslationsUpdateSerializer(serializers.Serializer):
    """Validates a ``{language_code: description}`` map before it is stored."""

    translations = serializers.DictField(child=serializers.CharField(allow_blank=True, trim_whitespace=False))

    def validate_translations(self, value: dict[str, str]) -> dict[str, str]:
        cleaned: dict[str, str] = {}
        for language_code, description in value.items():
            normalized = normalize_language_tag(language_code)
            if not normalized:
                allowed = ', '.join(SUPPORTED_LANGUAGE_CODES)
                raise serializers.ValidationError(
                    f'Unsupported language code "{language_code}". Allowed values: {allowed}.',
                )
            cleaned[normalized] = description
        if not cleaned:
            raise serializers.ValidationError('At least one language version is required.')
        return cleaned


class PublicCropRevertSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    base_version = serializers.IntegerField(required=False, min_value=1)


class PublicCropRevisionSerializer(serializers.ModelSerializer):
    created_by_label = serializers.SerializerMethodField()

    class Meta:
        model = PublicCropRevision
        fields = [
            'id',
            'public_crop',
            'version',
            'action',
            'snapshot',
            'changed_fields',
            'restored_from_version',
            'created_by_label',
            'created_at',
        ]
        read_only_fields = fields

    def get_created_by_label(self, obj: PublicCropRevision) -> str:
        return get_public_user_label(obj.created_by)


class PublicCropDiscussionCommentSerializer(serializers.ModelSerializer):
    created_by_label = serializers.SerializerMethodField()
    deletion_kind = serializers.SerializerMethodField()
    delete_blocked_reason = serializers.SerializerMethodField()
    is_edited = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = PublicCropDiscussionComment
        fields = [
            'id',
            'topic',
            'parent',
            'body',
            'created_by_label',
            'created_at',
            'updated_at',
            'deleted_at',
            'deletion_kind',
            'delete_blocked_reason',
            'is_edited',
            'can_edit',
            'can_delete',
        ]
        read_only_fields = [
            'id',
            'topic',
            'created_by_label',
            'created_at',
            'updated_at',
            'deleted_at',
            'deletion_kind',
            'delete_blocked_reason',
            'is_edited',
            'can_edit',
            'can_delete',
        ]

    def get_created_by_label(self, obj: PublicCropDiscussionComment) -> str:
        return get_public_user_label(obj.created_by)

    def get_deletion_kind(self, obj: PublicCropDiscussionComment) -> str | None:
        if not obj.deleted_at:
            return None
        if obj.deleted_by_id is not None and obj.deleted_by_id == obj.created_by_id:
            return 'author'
        if obj.deleted_by_id is not None:
            return 'moderator'
        return 'unknown'

    def get_delete_blocked_reason(self, obj: PublicCropDiscussionComment) -> str | None:
        if obj.deleted_at:
            return None
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated or is_public_library_moderator(user):
            return None
        if obj.created_by_id != user.id:
            return None
        root_comment_id = self.context.get('root_comment_id')
        visible_reply_exists = bool(self.context.get('visible_reply_exists'))
        if root_comment_id == obj.id and visible_reply_exists:
            return 'visible_replies'
        return None

    def get_is_edited(self, obj: PublicCropDiscussionComment) -> bool:
        return bool(obj.edited_at and not obj.deleted_at)

    def get_can_edit(self, obj: PublicCropDiscussionComment) -> bool:
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and (obj.created_by_id == user.id or is_public_library_moderator(user)))

    def get_can_delete(self, obj: PublicCropDiscussionComment) -> bool:
        if obj.deleted_at:
            return False
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        may_moderate = is_public_library_moderator(user)
        if obj.created_by_id != user.id and not may_moderate:
            return False
        root_comment_id = self.context.get('root_comment_id')
        if root_comment_id is None:
            root_comment_id = obj.topic.comments.order_by('created_at', 'id').values_list('id', flat=True).first()
        if may_moderate or obj.id != root_comment_id:
            return True
        return not bool(self.context.get('visible_reply_exists'))

    def validate_body(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Comment must not be empty.')
        return value


class PublicCropDiscussionTopicSerializer(serializers.ModelSerializer):
    created_by_label = serializers.SerializerMethodField()
    version = serializers.IntegerField(source='revision.version', read_only=True)
    comment_count = serializers.IntegerField(read_only=True)
    last_activity_at = serializers.DateTimeField(read_only=True)
    last_comment_preview = serializers.CharField(read_only=True, allow_blank=True, allow_null=True)

    class Meta:
        model = PublicCropDiscussionTopic
        fields = [
            'id',
            'public_crop',
            'title',
            'created_by_label',
            'created_at',
            'revision',
            'version',
            'comment_count',
            'last_activity_at',
            'last_comment_preview',
        ]
        read_only_fields = [
            'id',
            'public_crop',
            'created_by_label',
            'created_at',
            'version',
            'comment_count',
            'last_activity_at',
            'last_comment_preview',
        ]

    def get_created_by_label(self, obj: PublicCropDiscussionTopic) -> str:
        return get_public_user_label(obj.created_by)


class PublicCropChangeProposalSerializer(serializers.ModelSerializer):
    proposed_by_label = serializers.SerializerMethodField()
    reviewed_by_label = serializers.SerializerMethodField()

    class Meta:
        model = PublicCropChangeProposal
        fields = [
            'id',
            'public_crop',
            'summary',
            'proposed_data',
            'status',
            'proposed_by_label',
            'reviewed_by_label',
            'review_note',
            'reviewed_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'public_crop',
            'status',
            'proposed_by_label',
            'reviewed_by_label',
            'review_note',
            'reviewed_at',
            'created_at',
            'updated_at',
        ]

    def validate_proposed_data(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise serializers.ValidationError('Proposed data must be an object.')
        unknown_fields = sorted(set(value) - PUBLIC_CROP_PROPOSABLE_FIELDS)
        if unknown_fields:
            raise serializers.ValidationError(f"Unsupported proposal fields: {', '.join(unknown_fields)}")
        if not value:
            raise serializers.ValidationError('At least one changed field is required.')
        typed_serializer = PublicCropUpdateSerializer(data=value, partial=True)
        typed_serializer.is_valid(raise_exception=True)
        cleaned = dict(value)
        if 'seed_packages' in typed_serializer.validated_data:
            cleaned['seed_packages'] = PublicCropSeedPackageSerializer(
                typed_serializer.validated_data['seed_packages'],
                many=True,
            ).data
        return cleaned

    def get_proposed_by_label(self, obj: PublicCropChangeProposal) -> str:
        return get_public_user_label(obj.proposed_by)

    def get_reviewed_by_label(self, obj: PublicCropChangeProposal) -> str:
        return get_public_user_label(obj.reviewed_by)
