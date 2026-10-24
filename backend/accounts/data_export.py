from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.db.models import Model, Q, QuerySet
from django.utils import timezone

from accounts.models import (
    AccountDeletionRequest,
    DocumentConsent,
    PublicProfile,
    UserProjectSettings,
)
from farm.models import (
    Bed,
    BedLayout,
    Crop,
    CropSupplierData,
    EntityRevision,
    Field,
    FieldLayout,
    Location,
    NoteAttachment,
    PlantingPlan,
    Project,
    ProjectInvitation,
    ProjectMembership,
    PublicCrop,
    PublicCropReport,
    PublicCropTradeNameEvent,
    SeedPackage,
    Supplier,
    Task,
)

User = get_user_model()


def build_personal_data_export(user: User) -> dict[str, Any]:
    """Build a structured self-service export for the authenticated user."""
    project_ids = list(
        ProjectMembership.objects.filter(
            user=user,
            project__is_active=True,
            project__deleted_at__isnull=True,
        ).values_list('project_id', flat=True)
    )

    return {
        'schema_version': 1,
        'generated_at': timezone.now(),
        'account': _build_account_export(user),
        'memberships': _serialize_queryset(
            ProjectMembership.objects.select_related('project')
            .filter(user=user)
            .order_by('project__name', 'id')
        ),
        'projects': _build_projects_export(user=user, project_ids=project_ids),
        'public_library_contributions': _serialize_queryset(
            PublicCrop.objects.filter(created_by=user).order_by('name', 'variety', 'id')
        ),
        'public_library_trade_name_changes': _serialize_queryset(
            PublicCropTradeNameEvent.objects.filter(created_by=user).order_by('created_at', 'id')
        ),
        'public_library_reports': [
            # Who resolved a report is the moderator's data, not the reporter's.
            {
                key: value
                for key, value in _serialize_instance(report).items()
                if key != 'resolved_by_id'
            }
            for report in (
                PublicCropReport.objects.filter(reported_by=user).order_by('created_at', 'id')
            )
        ],
    }


def _build_account_export(user: User) -> dict[str, Any]:
    public_profile = PublicProfile.objects.filter(user=user).first()
    project_settings = UserProjectSettings.objects.filter(user=user).first()
    deletion = AccountDeletionRequest.objects.filter(user=user).first()

    return {
        'id': user.id,
        'email': user.email,
        'display_name': user.get_full_name(),
        'public_display_name': public_profile.public_display_name if public_profile else '',
        'is_active': user.is_active,
        'date_joined': user.date_joined,
        'last_login': user.last_login,
        'project_settings': _serialize_instance(project_settings) if project_settings else None,
        'account_deletion_request': _serialize_instance(deletion) if deletion else None,
        'document_consents': _serialize_queryset(
            DocumentConsent.objects.filter(user=user).order_by('document', 'version', 'accepted_at')
        ),
        'social_logins': _build_social_logins_export(user),
    }


def _build_social_logins_export(user: User) -> list[dict[str, Any]]:
    """Export the linked provider identities without their raw profile payloads."""
    return [
        {
            'provider': account.provider,
            'provider_user_id': account.uid,
            'connected_at': _to_json_value(account.date_joined),
        }
        for account in SocialAccount.objects.filter(user=user).order_by('provider', 'id')
    ]


def _build_projects_export(
    *,
    user: User,
    project_ids: list[int],
) -> list[dict[str, Any]]:
    projects = Project.objects.filter(id__in=project_ids).order_by('name', 'id')
    return [
        {
            'project': _serialize_instance(project),
            'memberships': _serialize_queryset(
                ProjectMembership.objects.filter(project=project).order_by('user_id', 'id')
            ),
            'invitations': _serialize_queryset(
                _visible_invitations_for_user(user=user, project=project)
            ),
            'locations': _serialize_queryset(
                Location.objects.filter(project=project).order_by('name', 'id')
            ),
            'fields': _serialize_queryset(
                Field.objects.filter(project=project).order_by('location_id', 'name', 'id')
            ),
            'beds': _serialize_queryset(
                Bed.objects.filter(project=project).order_by('field_id', 'name', 'id')
            ),
            'field_layouts': _serialize_queryset(
                FieldLayout.objects.filter(project=project).order_by('field_id')
            ),
            'bed_layouts': _serialize_queryset(
                BedLayout.objects.filter(project=project).order_by('bed_id')
            ),
            'suppliers': _serialize_queryset(
                Supplier.objects.filter(project=project).order_by('name', 'id')
            ),
            'crops': _serialize_queryset(
                Crop.all_objects.filter(project=project).order_by('name', 'variety', 'id')
            ),
            'crop_supplier_data': _serialize_queryset(
                CropSupplierData.objects.filter(project=project).order_by('crop_id', 'supplier_id', 'id')
            ),
            'seed_packages': _serialize_queryset(
                SeedPackage.objects.filter(project=project).order_by('crop_id', 'size_unit', 'size_value', 'id')
            ),
            'planting_plans': _serialize_queryset(
                PlantingPlan.objects.filter(project=project).order_by('-planting_date', 'id')
            ),
            'tasks': _serialize_queryset(
                Task.objects.filter(project=project).order_by('due_date', '-created_at', 'id')
            ),
            'note_attachments': _serialize_queryset(
                NoteAttachment.objects.filter(project=project).order_by('-created_at', 'id')
            ),
            'history': _serialize_queryset(
                EntityRevision.objects.filter(project=project).order_by('-created_at', 'id')
            ),
        }
        for project in projects
    ]


def _visible_invitations_for_user(*, user: User, project: Project) -> QuerySet[ProjectInvitation]:
    normalized_email = User.objects.normalize_email(user.email).lower().strip()
    return ProjectInvitation.objects.filter(project=project).filter(
        Q(email_normalized=normalized_email)
        | Q(invited_by=user)
        | Q(accepted_by=user)
        | Q(revoked_by=user)
    ).order_by('-created_at', 'id')


def _serialize_queryset(queryset: QuerySet[Model]) -> list[dict[str, Any]]:
    return [_serialize_instance(instance) for instance in queryset]


def _serialize_instance(instance: Model) -> dict[str, Any]:
    return {
        field.attname: _to_json_value(getattr(instance, field.attname))
        for field in instance._meta.concrete_fields
    }


def _to_json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, 'name'):
        return value.name
    return value
