from __future__ import annotations

import re
import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.utils import translation
from django.utils.text import slugify
from django.utils.translation import gettext as _
from rest_framework import serializers

from accounts.demo_access import is_active_guest_demo_user
from config.languages import UI_LANGUAGE_AUTO, UI_LANGUAGE_VALUES
from crops.permissions import is_public_library_moderator
from farm.models import ProjectMembership
from farm.project_context import resolve_project_for_user
from farm.services.demo_project import is_demo_project_description

from .consent import get_pending_consent_documents, has_accepted_current, record_acceptance
from .disposable_domains import is_disposable_email_domain
from .models import AccountDeletionRequest, DocumentConsent, PublicProfile

User = get_user_model()
_username_validator = UnicodeUsernameValidator()
_password_field_kwargs = {'write_only': True}
if getattr(settings, 'DJANGO_ENV', 'production') != 'development':
    _password_field_kwargs['min_length'] = 8


def _de(message: str) -> str:
    with translation.override('de'):
        return _(message)


def normalize_email_lower(email: str) -> str:
    return User.objects.normalize_email(email).lower().strip()


def build_username_from_email(email: str) -> str:
    local_part = email.split('@', 1)[0]
    base = slugify(local_part).replace('-', '_')
    if not base:
        base = 'user'

    base = re.sub(r'[^\w.@+-]', '', base)
    max_base_length = 150 - 9
    candidate = base[:max_base_length]

    while True:
        suffix = uuid.uuid4().hex[:8]
        username = f'{candidate}_{suffix}'
        try:
            _username_validator(username)
        except Exception:  # noqa: BLE001
            continue
        if not User.objects.filter(username=username).exists():
            return username


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    display_label = serializers.SerializerMethodField()
    public_display_name = serializers.SerializerMethodField()
    default_project_id = serializers.SerializerMethodField()
    last_project_id = serializers.SerializerMethodField()
    memberships = serializers.SerializerMethodField()
    resolved_project_id = serializers.SerializerMethodField()
    needs_project_selection = serializers.SerializerMethodField()
    account_pending_deletion = serializers.SerializerMethodField()
    scheduled_deletion_at = serializers.SerializerMethodField()
    pending_consents = serializers.SerializerMethodField()
    public_library_terms_accepted = serializers.SerializerMethodField()
    is_public_library_moderator = serializers.SerializerMethodField()
    is_guest_demo = serializers.SerializerMethodField()
    guest_demo_session_id = serializers.SerializerMethodField()
    has_password = serializers.SerializerMethodField()
    ui_language = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id',
            'email',
            'display_name',
            'display_label',
            'public_display_name',
            'is_active',
            'is_staff',
            'is_superuser',
            'default_project_id',
            'last_project_id',
            'memberships',
            'resolved_project_id',
            'needs_project_selection',
            'account_pending_deletion',
            'scheduled_deletion_at',
            'pending_consents',
            'public_library_terms_accepted',
            'is_public_library_moderator',
            'is_guest_demo',
            'guest_demo_session_id',
            'has_password',
            'ui_language',
        )
        read_only_fields = fields

    def get_ui_language(self, obj: User) -> str:
        """Stored UI language preference: 'auto', 'de' or 'en'."""
        settings_row = getattr(obj, 'project_settings', None)
        return getattr(settings_row, 'ui_language', UI_LANGUAGE_AUTO) or UI_LANGUAGE_AUTO

    def get_display_name(self, obj: User) -> str:
        full_name = f'{obj.first_name} {obj.last_name}'.strip()
        return full_name

    def get_display_label(self, obj: User) -> str:
        full_name = self.get_display_name(obj)
        return full_name or obj.email or obj.username

    def get_public_display_name(self, obj: User) -> str:
        public_profile = getattr(obj, 'public_profile', None)
        return public_profile.public_display_name if public_profile else ''

    def get_default_project_id(self, obj: User) -> int | None:
        settings = getattr(obj, 'project_settings', None)
        project = getattr(settings, 'default_project', None)
        if project is None or project.deleted_at is not None:
            return None
        return project.id

    def get_last_project_id(self, obj: User) -> int | None:
        settings = getattr(obj, 'project_settings', None)
        project = getattr(settings, 'last_project', None)
        if project is None or project.deleted_at is not None:
            return None
        return project.id

    def get_memberships(self, obj: User) -> list[dict[str, str | int | bool]]:
        rows = ProjectMembership.objects.select_related('project').filter(
            user=obj,
            project__is_active=True,
            project__deleted_at__isnull=True,
        )
        return [
            {
                'project_id': row.project_id,
                'project_name': row.project.name,
                'project_region': row.project.region,
                'role': row.role,
                'is_demo_project': is_demo_project_description(row.project.description),
            }
            for row in rows
        ]

    def get_resolved_project_id(self, obj: User) -> int | None:
        project, _ = resolve_project_for_user(obj)
        return project.id if project else None

    def get_needs_project_selection(self, obj: User) -> bool:
        _, needs_selection = resolve_project_for_user(obj)
        return needs_selection

    def get_account_pending_deletion(self, obj: User) -> bool:
        deletion = AccountDeletionRequest.objects.filter(user=obj).first()
        return bool(deletion and deletion.is_pending)

    def get_scheduled_deletion_at(self, obj: User) -> str | None:
        deletion = AccountDeletionRequest.objects.filter(user=obj).first()
        if deletion is None or deletion.scheduled_deletion_at is None or deletion.deleted_at is not None:
            return None
        return deletion.scheduled_deletion_at.isoformat()

    def get_pending_consents(self, obj: User) -> list[str]:
        return [] if self.get_is_guest_demo(obj) else get_pending_consent_documents(obj)

    def get_is_guest_demo(self, obj: User) -> bool:
        return is_active_guest_demo_user(obj)

    def get_guest_demo_session_id(self, obj: User) -> int | None:
        return obj.guest_demo_session.id if self.get_is_guest_demo(obj) else None

    def get_has_password(self, obj: User) -> bool:
        """Whether the account can sign in with email and password.

        Accounts created through Google/Microsoft have no usable password
        until they set one via the password reset flow.
        """
        return obj.has_usable_password()

    def get_public_library_terms_accepted(self, obj: User) -> bool:
        return has_accepted_current(obj, DocumentConsent.DOCUMENT_PUBLIC_LIBRARY)

    def get_is_public_library_moderator(self, obj: User) -> bool:
        return is_public_library_moderator(obj)


class ConsentAcceptSerializer(serializers.Serializer):
    document = serializers.ChoiceField(choices=DocumentConsent.DOCUMENT_CHOICES)


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    display_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    password = serializers.CharField(**_password_field_kwargs)
    password_confirm = serializers.CharField(**_password_field_kwargs)
    # Honeypot: real users never see or fill this field (hidden in the form).
    # A filled value marks the submission as automated; RegisterView discards
    # it silently instead of surfacing this as a validation error.
    website = serializers.CharField(required=False, allow_blank=True, write_only=True)

    def validate_email(self, value: str) -> str:
        normalized = normalize_email_lower(value)
        if User.objects.filter(email__iexact=normalized).exists():
            raise serializers.ValidationError(_de(_('An account with this email already exists.')))
        if is_disposable_email_domain(normalized):
            raise serializers.ValidationError(
                _de(_('Please use a permanent email address instead of a disposable one.')),
            )
        return normalized

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({'password_confirm': _de(_('Passwords do not match.'))})
        validate_password(str(attrs['password']))
        return attrs

    def create(self, validated_data: dict[str, object]) -> User:
        display_name = str(validated_data.get('display_name', '')).strip()
        user = User.objects.create_user(
            username=build_username_from_email(str(validated_data['email'])),
            email=str(validated_data['email']),
            password=str(validated_data['password']),
            first_name=display_name,
            is_active=False,
        )
        record_acceptance(user, DocumentConsent.DOCUMENT_TERMS)
        return user


class ActivateSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class ResendActivationSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(**_password_field_kwargs)
    password_confirm = serializers.CharField(**_password_field_kwargs)

    def validate(self, attrs: dict[str, str]) -> dict[str, str]:
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({'password_confirm': _de(_('Passwords do not match.'))})
        validate_password(attrs['password'])
        return attrs


class AccountDeleteRequestSerializer(serializers.Serializer):
    # Optional because accounts created through Google/Microsoft have no
    # usable password to confirm with; the view enforces it whenever the
    # account does have one.
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)


class AccountRestoreSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class AccountProfileSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=255, allow_blank=True, required=True)


class AccountLanguageSerializer(serializers.Serializer):
    """Validates the personal UI language preference before it is stored."""

    ui_language = serializers.CharField(max_length=10)

    def validate_ui_language(self, value: str) -> str:
        normalized = (value or '').strip().lower()
        if normalized not in UI_LANGUAGE_VALUES:
            allowed = ', '.join(sorted(UI_LANGUAGE_VALUES))
            raise serializers.ValidationError(f'Unsupported language. Allowed values: {allowed}.')
        return normalized or UI_LANGUAGE_AUTO


class AccountPublicProfileSerializer(serializers.Serializer):
    public_display_name = serializers.CharField(max_length=255, allow_blank=True, required=True)

    def validate_public_display_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            return value
        request = self.context.get('request')
        queryset = PublicProfile.objects.filter(public_display_name__iexact=value)
        if request is not None:
            queryset = queryset.exclude(user=request.user)
        if queryset.exists():
            raise serializers.ValidationError('Dieser Name wird bereits verwendet.')
        return value


class AccountEmailChangeRequestSerializer(serializers.Serializer):
    new_email = serializers.EmailField()
    # See AccountDeleteRequestSerializer.password.
    current_password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    def validate_new_email(self, value: str) -> str:
        normalized = normalize_email_lower(value)
        user: User = self.context['request'].user
        if normalized == normalize_email_lower(user.email):
            raise serializers.ValidationError('Die neue E-Mail-Adresse muss sich von der aktuellen unterscheiden.')
        if User.objects.filter(email__iexact=normalized).exclude(pk=user.pk).exists():
            raise serializers.ValidationError(_de(_('An account with this email already exists.')))
        return normalized


class AccountEmailChangeConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    request_id = serializers.UUIDField()


class AccountPasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(**_password_field_kwargs)
    new_password_confirm = serializers.CharField(**_password_field_kwargs)

    def validate(self, attrs: dict[str, str]) -> dict[str, str]:
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({'new_password_confirm': _de(_('Passwords do not match.'))})
        validate_password(attrs['new_password'], user=self.context['request'].user)
        return attrs
