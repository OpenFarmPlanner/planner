"""
Defined independently from `farm.crops.serializers.PublicCropSerializer` on
purpose, even though the two are currently near-identical: this app must
depend on `farm.models` only, never on farm's domain serializer/view packages
(that would put the dependency arrow backwards — see
docs/crop-library-architecture.md). The small duplication is the
deliberate cost of keeping that direction correct until `PublicCrop`
itself moves into this app.
"""
from django.db.models import Q
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from config.languages import (
    DEFAULT_LANGUAGE_CODE,
    SUPPORTED_LANGUAGE_CODES,
    normalize_language_tag,
    resolve_request_language,
)
from farm.crops.serializers.public import get_public_user_label
from farm.models import PublicCrop

from . import services
from .models import (
    SUPPORTED_REGIONAL_NAME_KEYS,
    CropSpecies,
    CropSpeciesTranslation,
    PublicLibraryModeratorRequest,
)


def get_request_language(context: dict) -> str:
    """Preferred content language for the request behind a serializer context."""
    request = context.get('request')
    if request is None:
        return DEFAULT_LANGUAGE_CODE
    return resolve_request_language(request)


def get_request_region(context: dict) -> str:
    """Active project's regional terminology setting, when a project context exists."""
    request = context.get('request')
    if request is None:
        return ''
    active_project = getattr(request, 'active_project', None)
    if active_project is not None:
        return getattr(active_project, 'region', '') or ''
    try:
        from farm.project_context import get_active_project_optional
        active_project = get_active_project_optional(request)
    except Exception:  # noqa: BLE001
        return ''
    return getattr(active_project, 'region', '') if active_project is not None else ''


def _bounded_levenshtein(left: str, right: str, max_distance: int) -> int:
    """Small typo-distance helper for proposal hints."""
    if abs(len(left) - len(right)) > max_distance:
        return max_distance + 1
    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, start=1):
        current = [left_index]
        row_min = current[0]
        for right_index, right_char in enumerate(right, start=1):
            substitution_cost = 0 if left_char == right_char else 1
            value = min(
                previous[right_index] + 1,
                current[right_index - 1] + 1,
                previous[right_index - 1] + substitution_cost,
            )
            current.append(value)
            row_min = min(row_min, value)
        if row_min > max_distance:
            return max_distance + 1
        previous = current
    return previous[-1]


def _species_search_terms(species: CropSpecies) -> set[str]:
    terms = {species.name_normalized}
    for translation in species.translations.all():
        terms.add(translation.common_name_normalized)
        terms.update(term for term in translation.search_text_normalized.splitlines() if term)
    return {term for term in terms if term}


def _species_fuzzy_distance(left: str, right: str) -> int:
    max_distance = 1 if min(len(left), len(right)) < 8 else 2
    return _bounded_levenshtein(left, right, max_distance)


class CropSpeciesTranslationSerializer(serializers.ModelSerializer):
    """One language version of a species name.

    Editorial and moderation views need every translation, so this is exposed
    alongside the single resolved ``display_name`` the app UI uses.
    """

    class Meta:
        model = CropSpeciesTranslation
        fields = ['id', 'language_code', 'common_name', 'synonyms', 'regional_names']
        read_only_fields = ['id']

    def validate_language_code(self, value: str) -> str:
        normalized = normalize_language_tag(value)
        if not normalized:
            allowed = ', '.join(SUPPORTED_LANGUAGE_CODES)
            raise serializers.ValidationError(
                f'Unsupported language code. Allowed values: {allowed}.',
            )
        return normalized

    def validate_common_name(self, value: str) -> str:
        trimmed = ' '.join((value or '').split())
        if not trimmed:
            raise serializers.ValidationError('A common name is required.')
        return trimmed

    def validate_synonyms(self, value: list) -> list[str]:
        if not isinstance(value, list):
            raise serializers.ValidationError('Synonyms must be a list of strings.')
        cleaned: list[str] = []
        seen: set[str] = set()
        for entry in value:
            if not isinstance(entry, str):
                raise serializers.ValidationError('Synonyms must be strings.')
            synonym = ' '.join(entry.split())
            key = synonym.casefold()
            if synonym and key not in seen:
                cleaned.append(synonym)
                seen.add(key)
        return cleaned

    def validate_regional_names(self, value: dict) -> dict[str, str]:
        if not isinstance(value, dict):
            raise serializers.ValidationError('Regional names must be an object.')
        cleaned: dict[str, str] = {}
        for key, raw_name in value.items():
            region = str(key or '').strip().lower()
            if region not in SUPPORTED_REGIONAL_NAME_KEYS:
                allowed = ', '.join(sorted(SUPPORTED_REGIONAL_NAME_KEYS))
                raise serializers.ValidationError(
                    f'Unsupported region "{key}". Allowed values: {allowed}.',
                )
            if not isinstance(raw_name, str):
                raise serializers.ValidationError('Regional names must be strings.')
            name = ' '.join(raw_name.split())
            if name:
                cleaned[region] = name
        return cleaned


class CropSpeciesSearchMatchSerializer(serializers.Serializer):
    """Why a ``?q=`` search result matched — see `services.CropSpeciesSearchHit`."""

    source = serializers.ChoiceField(choices=services.SPECIES_MATCH_SOURCE_ORDER)
    synonym = serializers.CharField(
        allow_blank=True,
        help_text=(
            'The synonym, regional or other-language name that matched; '
            'empty unless source is "synonym".'
        ),
    )


class CropSpeciesSerializer(serializers.ModelSerializer):
    """Official species that project crops may link to before publication.

    Exposes both shapes on purpose: ``display_name`` is the single resolved
    name the app renders, ``translations`` is the full set that editorial and
    moderation screens need in order to edit any language.
    """

    proposed_by_label = serializers.SerializerMethodField()
    reviewed_by_label = serializers.SerializerMethodField()
    similar_species = serializers.SerializerMethodField()
    translations = CropSpeciesTranslationSerializer(many=True, required=False)
    display_name = serializers.SerializerMethodField()
    display_language_code = serializers.SerializerMethodField()
    search_names = serializers.SerializerMethodField()
    search_match = serializers.SerializerMethodField()

    class Meta:
        model = CropSpecies
        fields = [
            'id',
            'name',
            'scientific_name',
            'family',
            'categories',
            'status',
            'proposed_by_label',
            'reviewed_by_label',
            'review_note',
            'reviewed_at',
            'similar_species',
            'translations',
            'display_name',
            'display_language_code',
            'search_names',
            'search_match',
        ]
        read_only_fields = [
            'id',
            'status',
            'proposed_by_label',
            'reviewed_by_label',
            'review_note',
            'reviewed_at',
            'similar_species',
            'display_name',
            'display_language_code',
            'search_names',
            'search_match',
        ]

    def get_display_name(self, obj: CropSpecies) -> str:
        return obj.localized_name(
            get_request_language(self.context),
            get_request_region(self.context),
        )[0]

    def get_display_language_code(self, obj: CropSpecies) -> str:
        """The language actually rendered — '' when only the canonical name existed.

        The UI uses this to note "only available in another language" instead
        of passing a German name off as an English one.
        """
        return obj.localized_name(
            get_request_language(self.context),
            get_request_region(self.context),
        )[1]

    def get_search_names(self, obj: CropSpecies) -> list[str]:
        return obj.search_names()

    @extend_schema_field(CropSpeciesSearchMatchSerializer(allow_null=True))
    def get_search_match(self, obj: CropSpecies) -> dict[str, str] | None:
        """How this row matched the list's ``q`` search; null outside a search."""
        hit = self.context.get('search_matches', {}).get(obj.pk)
        if hit is None:
            return None
        return {'source': hit.match_source, 'synonym': hit.matched_synonym}

    def create(self, validated_data: dict) -> CropSpecies:
        translations = validated_data.pop('translations', [])
        species = super().create(validated_data)
        self._write_translations(species, translations)
        return species

    def update(self, instance: CropSpecies, validated_data: dict) -> CropSpecies:
        translations = validated_data.pop('translations', None)
        species = super().update(instance, validated_data)
        if translations is not None:
            self._write_translations(species, translations)
        return species

    def validate_categories(self, value: list) -> list[str]:
        if not isinstance(value, list):
            raise serializers.ValidationError('Categories must be a list of strings.')
        cleaned: list[str] = []
        seen: set[str] = set()
        for entry in value:
            if not isinstance(entry, str):
                raise serializers.ValidationError('Categories must be strings.')
            category = ' '.join(entry.split()).lower()
            if category and category not in seen:
                cleaned.append(category)
                seen.add(category)
        return cleaned

    @staticmethod
    def _write_translations(species: CropSpecies, translations: list[dict]) -> None:
        """Upsert the supplied languages; languages left out stay untouched.

        Not filling in every supported language is a normal state — one
        language version is enough to publish — so omitted languages must not
        be interpreted as "delete this translation".
        """
        for entry in translations:
            language_code = entry.get('language_code')
            common_name = entry.get('common_name')
            if not language_code or not common_name:
                continue
            CropSpeciesTranslation.objects.update_or_create(
                species=species,
                language_code=language_code,
                defaults={
                    'common_name': common_name,
                    'synonyms': entry.get('synonyms', []),
                    'regional_names': entry.get('regional_names', {}),
                },
            )

    def validate_translations(self, value: list[dict]) -> list[dict]:
        seen: set[str] = set()
        for entry in value:
            language_code = entry.get('language_code')
            if language_code in seen:
                raise serializers.ValidationError(
                    f'Duplicate translation for language "{language_code}".',
                )
            seen.add(language_code)
        return value

    def get_proposed_by_label(self, obj: CropSpecies) -> str:
        return get_public_user_label(obj.proposed_by)

    def get_reviewed_by_label(self, obj: CropSpecies) -> str:
        return get_public_user_label(obj.reviewed_by)

    def get_similar_species(self, obj: CropSpecies) -> list[dict[str, str | int]]:
        """Published species that a pending proposal probably duplicates.

        Matches across *all* languages: proposing "Tomato" when "Tomate"
        already exists is a duplicate of the same species, not a new one.
        """
        if obj.status != CropSpecies.STATUS_PROPOSED:
            return []
        language = get_request_language(self.context)
        query = (
            CropSpecies.objects
            .filter(status=CropSpecies.STATUS_PUBLISHED)
            .exclude(pk=obj.pk)
            .prefetch_related('translations')
        )
        exact = query.filter(
            Q(name_normalized=obj.name_normalized)
            | Q(translations__common_name_normalized=obj.name_normalized)
            | Q(translations__search_text_normalized__icontains=f'\n{obj.name_normalized}\n'),
        ).distinct().first()
        if exact is not None:
            return [{
                'id': exact.id,
                'name': exact.name,
                'display_name': exact.localized_name(language, get_request_region(self.context))[0],
                'match_type': 'exact',
            }]
        if not obj.name:
            return []
        needle = obj.name[:24]
        normalized_needle = obj.name_normalized[:24]
        similar_items = list(query.filter(
            Q(name__icontains=needle)
            | Q(translations__common_name__icontains=needle)
            | Q(translations__search_text_normalized__icontains=normalized_needle),
        ).distinct().order_by('name')[:5])
        if len(similar_items) < 5 and obj.name_normalized:
            seen_ids = {item.id for item in similar_items}
            for candidate in query.order_by('name'):
                if candidate.id in seen_ids:
                    continue
                if any(
                    _species_fuzzy_distance(obj.name_normalized, term)
                    <= (1 if min(len(obj.name_normalized), len(term)) < 8 else 2)
                    for term in _species_search_terms(candidate)
                ):
                    similar_items.append(candidate)
                    seen_ids.add(candidate.id)
                    if len(similar_items) >= 5:
                        break
        return [
            {
                'id': item.id,
                'name': item.name,
                'display_name': item.localized_name(language, get_request_region(self.context))[0],
                'match_type': 'similar',
            }
            for item in similar_items
        ]

    def validate_name(self, value: str) -> str:
        from farm.utils import normalize_text

        trimmed = ' '.join(value.split())
        if not trimmed:
            raise serializers.ValidationError('A crop species name is required.')
        normalized = normalize_text(trimmed)
        # A name that already exists as *any* language's common name is the
        # same species — reject it rather than creating a parallel record.
        clashes = CropSpecies.objects.filter(
            Q(name_normalized=normalized)
            | Q(translations__common_name_normalized=normalized)
            | Q(translations__search_text_normalized__icontains=f'\n{normalized}\n'),
        )
        if self.instance is not None:
            clashes = clashes.exclude(pk=self.instance.pk)
        if clashes.exists():
            raise serializers.ValidationError(
                'This crop species already exists or has already been proposed.',
            )
        return trimmed


class PublicLibraryModeratorRequestSerializer(serializers.ModelSerializer):
    user_label = serializers.SerializerMethodField()
    reviewed_by_label = serializers.SerializerMethodField()

    class Meta:
        model = PublicLibraryModeratorRequest
        fields = [
            'id',
            'user',
            'user_label',
            'motivation',
            'status',
            'reviewed_by_label',
            'review_note',
            'reviewed_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'user',
            'user_label',
            'status',
            'reviewed_by_label',
            'review_note',
            'reviewed_at',
            'created_at',
            'updated_at',
        ]
        extra_kwargs = {
            'motivation': {'required': True, 'allow_blank': False, 'max_length': 2000},
        }

    def get_user_label(self, obj: PublicLibraryModeratorRequest) -> str:
        return (
            get_public_user_label(obj.user)
            or getattr(obj.user, 'email', '')
            or getattr(obj.user, 'username', '')
        )

    def get_reviewed_by_label(self, obj: PublicLibraryModeratorRequest) -> str:
        return get_public_user_label(obj.reviewed_by)


class CropSerializer(serializers.ModelSerializer):
    """Read-only representation of a published crop, for the /api/crop-library/ surface.

    ``variety`` is served verbatim in every language — variety names are
    proper names. Only the species common name and the public description are
    resolved per language.
    """

    created_by_label = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    display_language_code = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    description_language_code = serializers.SerializerMethodField()
    crop_species_translations = serializers.SerializerMethodField()
    crop_species_search_names = serializers.SerializerMethodField()
    # Mirrors `PublicCropSerializer.crop_species_status`: `proposed` marks a
    # species that is still awaiting moderation, which the UI shows as pending.
    crop_species_status = serializers.CharField(
        source='crop_species.status',
        read_only=True,
        default='',
    )

    class Meta:
        model = PublicCrop
        fields = [
            'id',
            'status',
            'name',
            'variety',
            'notes',
            'crop_species',
            'crop_species_name',
            'crop_species_status',
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
            'row_spacing_m',
            'sowing_depth_m',
            'seed_rate_value',
            'seed_rate_unit',
            'seed_rate_by_cultivation',
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
            'display_name',
            'display_language_code',
            'description',
            'description_language_code',
            'crop_species_translations',
            'crop_species_search_names',
        ]
        read_only_fields = fields

    crop_species_name = serializers.CharField(
        source='crop_species.name',
        read_only=True,
        default='',
    )

    def get_created_by_label(self, obj: PublicCrop) -> str:
        return obj.created_by_label

    def get_display_name(self, obj: PublicCrop) -> str:
        return obj.display_name(
            get_request_language(self.context),
            get_request_region(self.context),
        )[0]

    def get_display_language_code(self, obj: PublicCrop) -> str:
        return obj.display_name(
            get_request_language(self.context),
            get_request_region(self.context),
        )[1]

    def get_description(self, obj: PublicCrop) -> str:
        return obj.localized_description(get_request_language(self.context))[0]

    def get_description_language_code(self, obj: PublicCrop) -> str | None:
        return obj.localized_description(get_request_language(self.context))[1]

    def get_crop_species_translations(self, obj: PublicCrop) -> dict[str, str]:
        """All species names, so editorial screens can show every language."""
        if obj.crop_species is None:
            return {}
        return obj.crop_species.translations_by_language()

    def get_crop_species_search_names(self, obj: PublicCrop) -> list[str]:
        if obj.crop_species is None:
            return []
        return obj.crop_species.search_names()
