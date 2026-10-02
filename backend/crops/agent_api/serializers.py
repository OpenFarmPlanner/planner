"""Serializers for crop-library API token self-service."""

from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from crops.models import CropLibraryApiToken

# Same bound as `farm.agent_api.serializers.MAX_TOKEN_LIFETIME_DAYS` — an
# unbounded credential is a credential nobody ever rotates.
MAX_TOKEN_LIFETIME_DAYS = 365


class CropLibraryApiTokenSerializer(serializers.ModelSerializer):
    """Read representation of a token. Never contains the secret."""

    status = serializers.CharField(read_only=True)

    class Meta:
        model = CropLibraryApiToken
        fields = [
            'id',
            'name',
            'scope',
            'token_prefix',
            'status',
            'created_at',
            'expires_at',
            'last_used_at',
            'revoked_at',
        ]
        read_only_fields = fields


class CropLibraryApiTokenCreateSerializer(serializers.Serializer):
    """Validate a crop-library token-creation request."""

    name = serializers.CharField(max_length=120)
    scope = serializers.ChoiceField(
        choices=CropLibraryApiToken.SCOPE_CHOICES,
        default=CropLibraryApiToken.SCOPE_READ,
    )
    expires_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_name(self, value: str) -> str:
        """Require a non-empty label so tokens stay distinguishable in listings."""
        name = value.strip()
        if not name:
            raise serializers.ValidationError('A token name is required.')
        return name

    def validate_expires_at(self, value):
        """Keep expiry in the future and within the maximum lifetime."""
        if value is None:
            return None
        now = timezone.now()
        if value <= now:
            raise serializers.ValidationError('The expiry date must be in the future.')
        if (value - now).days > MAX_TOKEN_LIFETIME_DAYS:
            raise serializers.ValidationError(
                f'The expiry date must be within {MAX_TOKEN_LIFETIME_DAYS} days.'
            )
        return value
