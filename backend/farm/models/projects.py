"""Projects, memberships, invitations, agent login, and media files."""

import hashlib
import secrets
from typing import Any

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from .base import TimestampedModel


class MediaFile(models.Model):
    """Stored media metadata used as file references in domain models."""

    project = models.ForeignKey(
        'Project',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='media_files',
    )
    storage_path = models.CharField(max_length=500, unique=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    orphaned_at = models.DateTimeField(null=True, blank=True)
    sha256 = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ['-uploaded_at']


class Project(TimestampedModel):
    """A collaborative workspace that owns farm planning data."""

    REGION_GERMANY = 'germany'
    REGION_AUSTRIA = 'austria'
    REGION_SWITZERLAND = 'switzerland'
    REGION_CHOICES = [
        (REGION_GERMANY, 'Germany'),
        (REGION_AUSTRIA, 'Austria'),
        (REGION_SWITZERLAND, 'Switzerland'),
    ]

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True)
    description = models.TextField(blank=True)
    region = models.CharField(max_length=20, choices=REGION_CHOICES, default=REGION_GERMANY)
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self) -> str:
        """Return project name for admin and debug output."""
        return self.name


class ProjectMembership(models.Model):
    """Membership relation between a user and a project."""

    ROLE_ADMIN = 'admin'
    ROLE_MEMBER = 'member'
    ROLE_CHOICES = [
        (ROLE_ADMIN, 'Admin'),
        (ROLE_MEMBER, 'Member'),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='project_memberships')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='memberships')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_MEMBER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'project'], name='unique_project_membership'),
        ]

    @property
    def is_admin(self) -> bool:
        """Return True if membership role grants admin permissions."""
        return self.role == self.ROLE_ADMIN


class ProjectInvitation(models.Model):
    """An invitation token for adding users to projects."""

    STATUS_PENDING = 'pending'
    STATUS_ACCEPTED = 'accepted'
    STATUS_REVOKED = 'revoked'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_ACCEPTED, 'Accepted'),
        (STATUS_REVOKED, 'Revoked'),
    ]

    ROLE_ADMIN = ProjectMembership.ROLE_ADMIN
    ROLE_MEMBER = ProjectMembership.ROLE_MEMBER
    ROLE_CHOICES = ProjectMembership.ROLE_CHOICES

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='invitations')
    email = models.EmailField()
    email_normalized = models.EmailField(blank=True, default='')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_MEMBER)
    token = models.CharField(max_length=128, unique=True, db_index=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='project_invitations_sent',
    )
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='project_invitations_accepted',
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='project_invitations_revoked',
    )
    message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['project', 'email_normalized'],
                condition=Q(status='pending'),
                name='unique_open_project_invitation_per_email',
            ),
        ]

    @staticmethod
    def normalize_email(email: str) -> str:
        """Normalize an invitation email for canonical comparisons.

        :param email: Raw email value from input.
        :return: Lower-cased, trimmed email value.
        """
        return (email or '').strip().lower()

    @property
    def resolved_status(self) -> str:
        """Resolve runtime status including expiry for pending invitations.

        :return: Resolved invitation status.
        """
        if self.status == self.STATUS_PENDING and self.is_expired:
            return 'expired'
        return self.status

    @property
    def is_expired(self) -> bool:
        """Return True if invitation expiry is in the past."""
        return timezone.now() >= self.expires_at

    @property
    def is_open(self) -> bool:
        """Return True if invitation can still be accepted."""
        return self.resolved_status == self.STATUS_PENDING

    def save(self, *args: Any, **kwargs: Any) -> None:
        """Persist normalized email before writing invitation records.

        :param args: Positional arguments for model save.
        :param kwargs: Keyword arguments for model save.
        :return: None.
        """
        self.email_normalized = self.normalize_email(self.email)
        self.email = self.email_normalized
        super().save(*args, **kwargs)


class AgentLoginToken(models.Model):
    """Reusable project-bound login token for superuser-only agent sessions."""

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='agent_login_tokens_created',
    )
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='agent_login_tokens')
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    used_at = models.DateTimeField(null=True, blank=True, db_index=True)
    used_by_ip = models.GenericIPAddressField(null=True, blank=True)
    used_user_agent = models.CharField(max_length=512, blank=True)

    class Meta:
        ordering = ['-created_at']

    @staticmethod
    def hash_token(raw_token: str) -> str:
        """Return SHA256 hash for opaque token storage."""
        return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()

    @classmethod
    def create_token(
        cls,
        *,
        created_by,
        project: Project,
        expires_at=None,
    ) -> tuple['AgentLoginToken', str]:
        """Create and persist a new one-time token for superusers."""
        if not getattr(created_by, 'is_superuser', False):
            raise PermissionError('Only superusers can create agent login tokens.')

        raw_token = secrets.token_urlsafe(48)
        token = cls.objects.create(
            created_by=created_by,
            project=project,
            token_hash=cls.hash_token(raw_token),
            expires_at=expires_at,
        )
        return token, raw_token

    @property
    def is_usable(self) -> bool:
        """Return True when token has not expired."""
        if self.expires_at is None:
            return True
        return timezone.now() < self.expires_at
