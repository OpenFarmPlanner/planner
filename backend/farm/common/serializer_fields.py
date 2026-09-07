"""Shared DRF serializer fields and helpers used across farm domain serializers."""

from rest_framework import serializers

from farm.models import Project


def _resolve_active_project_from_serializer(serializer) -> Project | None:
    """Resolve active project from serializer context or bound instance.

    Services that run a serializer outside a request cycle (imports, seeders)
    have no `request` to pass, so `context={'project': project}` is the
    supported way for them to supply the project the cross-project validators
    check against. Without it those validators cannot resolve a project on a
    create, and callers that need them must not be left silently unguarded —
    see `CropSerializer._validate_supplier_consistency`.
    """
    context_project = serializer.context.get('project')
    if context_project is not None:
        return context_project
    request = serializer.context.get('request')
    if request is not None:
        active_project = getattr(request, 'active_project', None)
        if active_project is not None:
            return active_project
    instance = getattr(serializer, 'instance', None)
    if instance is not None and hasattr(instance, 'project'):
        return instance.project
    return None


class AuditUserSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    email = serializers.EmailField()
    display_name = serializers.SerializerMethodField()
    display_label = serializers.SerializerMethodField()

    def get_display_name(self, obj) -> str:
        full_name = f'{obj.first_name or ""} {obj.last_name or ""}'.strip()
        return full_name or obj.username

    def get_display_label(self, obj) -> str:
        full_name = self.get_display_name(obj)
        if full_name:
            return f'{full_name} ({obj.email})'
        return obj.email or obj.username


class CentimetersField(serializers.FloatField):
    """Expose meter-based model fields as centimeters in the API."""

    def to_representation(self, value):
        if value is None:
            return None
        return float(value) * 100.0

    def to_internal_value(self, data):
        cm_value = super().to_internal_value(data)
        return cm_value / 100.0


class LocalizedDecimalField(serializers.DecimalField):
    """Decimal field that accepts comma decimals and returns float JSON values."""

    default_error_messages = {
        'invalid': 'Please enter a valid numeric value, e.g. 3.9.',
    }

    def to_internal_value(self, data):
        normalized = data
        if isinstance(data, str):
            normalized = data.strip().replace(',', '.')
        return super().to_internal_value(normalized)

    def to_representation(self, value):
        decimal_value = super().to_representation(value)
        if decimal_value is None:
            return None
        return float(decimal_value)
