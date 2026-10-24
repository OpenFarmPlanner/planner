"""Tenancy and revision mixins shared by the farm API viewsets."""

import time
from typing import Any

from django.db import OperationalError, transaction
from django.db.models import Model
from rest_framework.serializers import BaseSerializer

from farm.history import (
    _current_actor_label,
    _diff_changed_fields,
    _entity_display_name,
    _entity_type_for,
    _serialize_instance,
    record_entity_revision,
)
from farm.models import EntityRevision, Location
from farm.project_context import get_active_project_or_400
from farm.services.default_location import default_location_name_for_request


class ProjectRevisionMixin:
    """Record an EntityRevision for the active project after a mutation."""

    def record_revision(
        self,
        instance,
        action: str,
        *,
        previous_snapshot: dict[str, Any] | None = None,
        object_id: int | None = None,
        snapshot: dict[str, Any] | None = None,
        display_name: str | None = None,
        changed_fields: list[str] | None = None,
        batch_operation=None,
    ) -> None:
        resolved_snapshot = snapshot if snapshot is not None else _serialize_instance(instance)
        resolved_changed_fields = changed_fields
        if resolved_changed_fields is None:
            if action == EntityRevision.ACTION_CREATED:
                resolved_changed_fields = [EntityRevision.ACTION_CREATED]
            elif previous_snapshot is not None:
                resolved_changed_fields = _diff_changed_fields(previous_snapshot, resolved_snapshot)
            else:
                resolved_changed_fields = []
        record_entity_revision(
            project=getattr(self.request, 'active_project', None),
            entity_type=_entity_type_for(instance),
            object_id=object_id if object_id is not None else instance.pk,
            action=action,
            snapshot=resolved_snapshot,
            display_name=display_name if display_name is not None else _entity_display_name(instance),
            changed_fields=resolved_changed_fields,
            user_name=_current_actor_label(self.request),
            batch_operation=batch_operation,
        )

    def perform_update(self, serializer: BaseSerializer) -> None:
        """Save the update and record it against the pre-save snapshot.

        Viewsets that need extra save kwargs (e.g. `updated_by`) or their own
        IntegrityError mapping override this; everything else inherits it.
        """
        previous_snapshot = _serialize_instance(serializer.instance)
        instance = serializer.save()
        self.record_revision(instance, EntityRevision.ACTION_UPDATED, previous_snapshot=previous_snapshot)

    def perform_destroy(self, instance: Model) -> None:
        """Delete the instance and record the revision from a pre-delete snapshot.

        The id, snapshot and display name are read before `delete()` because the
        instance (and anything it resolves a label from) is gone afterwards.
        """
        instance_id = instance.pk
        snapshot = _serialize_instance(instance)
        display_name = _entity_display_name(instance)
        instance.delete()
        self.record_revision(
            instance, EntityRevision.ACTION_DELETED,
            object_id=instance_id, snapshot=snapshot, display_name=display_name, changed_fields=[],
        )


class ProjectScopedMixin:
    """Resolve active project from request and hard-scope querysets."""

    ensure_default_location = False

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        request.active_project = get_active_project_or_400(request)
        if self.ensure_default_location:
            self.ensure_active_project_location()

    def ensure_active_project_location(self) -> None:
        """Create the default location for legacy projects that do not have one.

        Only LocationViewSet opts into `ensure_default_location`, so this
        races specifically when two requests to /api/locations/ land close
        together for a brand-new project (e.g. the app's own initial GET list
        alongside an explicit POST creating the first location) — both see no
        location yet and both try to create one. Under SQLite this
        read-then-write is prone to "database is locked": ATOMIC_REQUESTS
        holds the write lock for a request's *entire* duration (not just this
        check), so a losing request can end up waiting out another request's
        full processing/serialization time, not just a quick DB write —
        easily longer than a couple hundred ms under CI load. Each attempt
        runs in its own savepoint so a failed attempt only rolls back that
        savepoint (not the whole request); the backoff is generous enough to
        outlast a competing request's full lifecycle, after which our
        `exists()` check sees its location and we return without duplicating
        it.
        """
        project = self.request.active_project
        name = default_location_name_for_request(self.request)
        attempts = 8
        for attempt in range(attempts):
            try:
                with transaction.atomic():
                    if Location.objects.filter(project=project).exists():
                        return
                    Location.objects.create(project=project, name=name)
                return
            except OperationalError as exc:
                if attempt == attempts - 1 or 'locked' not in str(exc).lower():
                    raise
                time.sleep(min(0.05 * (2 ** attempt), 0.5))

    def get_queryset(self):
        queryset = super().get_queryset()
        if hasattr(queryset.model, 'project'):
            return queryset.filter(project=self.request.active_project)
        return queryset

    def perform_create(self, serializer):
        if 'project' in serializer.fields:
            serializer.save(project=self.request.active_project)
            return
        serializer.save()
