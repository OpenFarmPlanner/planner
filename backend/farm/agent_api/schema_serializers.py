"""Response shapes for the published OpenAPI reference only.

These serializers are never used to render or validate a request; they
describe payloads that the views build as plain dicts, so the generated schema
matches what the endpoints actually return. Keep them in sync with the view
code they reference.
"""

from __future__ import annotations

from rest_framework import serializers


class ApiErrorSerializer(serializers.Serializer):
    """Standard error envelope built by ``config.responses.api_error_response``."""

    code = serializers.CharField(help_text='Stable machine-readable error code.')
    detail = serializers.CharField(help_text='Human-readable English explanation.')


class AgentContextSerializer(serializers.Serializer):
    """``AgentContextView`` payload."""

    project_id = serializers.IntegerField()
    project_name = serializers.CharField()
    token_scope = serializers.ChoiceField(choices=['read', 'write', 'delete'])


class CropImportDraftSerializer(serializers.Serializer):
    """``farm.agent_api.views._draft_payload``."""

    draft_id = serializers.UUIDField()
    checksum = serializers.CharField(help_text='Send back unchanged to the apply endpoint.')
    status = serializers.CharField()
    source_label = serializers.CharField(allow_blank=True)
    created_at = serializers.DateTimeField()
    expires_at = serializers.DateTimeField()
    applied_at = serializers.DateTimeField(allow_null=True)
    has_errors = serializers.BooleanField()
    has_warnings = serializers.BooleanField()
    requires_confirmation = serializers.BooleanField()
    summary = serializers.DictField(help_text='Row counts per planned action and severity.')
    items = serializers.ListField(
        child=serializers.DictField(),
        help_text='Per-row analysis: planned action, matched crop, normalized fields, issues.',
    )
    result = serializers.DictField(allow_null=True, help_text='Apply result once applied.')


class CropImportApplyResultSerializer(serializers.Serializer):
    """Result of ``farm.services.crop_import.apply.apply_import_draft``."""

    draft_id = serializers.UUIDField()
    created_count = serializers.IntegerField()
    updated_count = serializers.IntegerField()
    already_applied = serializers.BooleanField(
        required=False,
        help_text='Present and true when the draft had already been applied; nothing was written.',
    )


class CropDuplicateCheckSerializer(serializers.Serializer):
    """``CropViewSet.duplicate_check`` payload."""

    exists = serializers.BooleanField(help_text='A crop with this exact name and variety exists.')
    name_exists = serializers.BooleanField(
        required=False,
        help_text='A general crop (empty variety) with this name exists.',
    )


class SeedRateConstraintsSerializer(serializers.Serializer):
    """``CropViewSet.seed_rate_constraints`` payload."""

    units = serializers.DictField(help_text='Value constraints keyed by seed-rate unit.')


class CropDeletePreviewVarietySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class CropDeletePreviewSerializer(serializers.Serializer):
    """``CropViewSet._delete_preview_payload``."""

    crop_ids = serializers.ListField(child=serializers.IntegerField())
    varieties = CropDeletePreviewVarietySerializer(many=True)
    variety_count = serializers.IntegerField()
    planning_data_count = serializers.IntegerField()
    deletes_general_crop = serializers.BooleanField()
    group_without_general = serializers.BooleanField()


class PublishPublicRequestSerializer(serializers.Serializer):
    """Body fields ``CropViewSet.publish_public`` reads."""

    accepted_public_library_terms = serializers.BooleanField(required=False)
    publish_as_general = serializers.BooleanField(required=False)
    crop_species_id = serializers.IntegerField(required=False, allow_null=True)
    original_language_code = serializers.CharField(required=False)


class PublishPublicResponseSerializer(serializers.Serializer):
    """``CropViewSet.publish_public`` payload.

    API tokens always receive ``operation: pending_moderation`` (HTTP 202) with
    ``change_proposal``; ``public_crop`` is only returned for live publishes by
    established session users.
    """

    operation = serializers.CharField()
    public_crop = serializers.DictField(required=False)
    change_proposal = serializers.DictField(required=False)
    duplicates = serializers.ListField(child=serializers.DictField())
