from __future__ import annotations

from datetime import date, timedelta
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from django.utils.crypto import get_random_string

from farm.models import Project, ProjectMembership
from farm.services.demo_project import (
    demo_project_used_filter,
    get_demo_project_description,
    get_demo_project_name,
    populate_demo_project,
    resolve_demo_language,
)

from .models import GuestDemoSession, GuestDemoUsageDay, UserProjectSettings
from .signals import suppress_registration_notification

User = get_user_model()
GUEST_DEMO_RETENTION = timedelta(hours=8)


def create_guest_demo_session(*, language_code: str | None = None) -> GuestDemoSession:
    """Create an isolated, short-lived guest workspace from the demo template."""
    suffix = get_random_string(16).lower()
    language = resolve_demo_language(language_code)
    project_name = get_demo_project_name(language)
    project_description = get_demo_project_description(language)
    with transaction.atomic():
        with suppress_registration_notification():
            user = User.objects.create_user(
                username=f'demo_{suffix}',
                email=f'demo-{suffix}@example.invalid',
                password=None,
                is_active=True,
            )
        project = Project.objects.create(
            name=project_name,
            slug=f'guest-demo-{suffix}',
            description=project_description,
        )
        ProjectMembership.objects.create(user=user, project=project, role=ProjectMembership.ROLE_ADMIN)
        UserProjectSettings.objects.create(user=user, default_project=project, last_project=project, ui_language=language)
        populate_demo_project(project, owner=user, language_code=language)
        _increment_usage_counter(timezone.localdate(), 'started')
        return GuestDemoSession.objects.create(
            user=user,
            project=project,
            expires_at=timezone.now() + GUEST_DEMO_RETENTION,
        )


def delete_guest_demo_session(session: GuestDemoSession) -> None:
    """Delete a guest workspace and its user, including all project data.

    Whether the guest changed anything is booked to the anonymous daily
    counter first, because the revisions that show it are deleted with the
    project.
    """
    project = session.project
    user = session.user
    with transaction.atomic():
        if Project.objects.filter(pk=project.pk).filter(demo_project_used_filter()).exists():
            _increment_usage_counter(timezone.localdate(session.created_at), 'used')
        project.delete()
        user.delete()


def _increment_usage_counter(day: date, field_name: str) -> None:
    GuestDemoUsageDay.objects.get_or_create(date=day)
    GuestDemoUsageDay.objects.filter(date=day).update(**{field_name: F(field_name) + 1})
