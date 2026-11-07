"""Persist dated planting-plan events as independently completable tasks."""

from collections.abc import Iterable
from datetime import date, timedelta
from typing import Any

from django.db import transaction

from farm.models import PlantingPlan, Task
from farm.services.crop_inheritance import build_general_crop_index, resolve_crop_field

AUTOMATIC_TASK_TITLES = {
    'propagation_start': 'Start propagation',
    'sowing': 'Direct sowing',
    'planting': 'Transplant',
    'harvest_start': 'Start harvesting',
    'harvest_end': 'Finish harvesting',
}


def plan_event_dates(
    plan: PlantingPlan, crop_index: dict[int, Any] | None = None,
) -> dict[str, date]:
    """Resolve known events from the same effective timing values as the plan."""
    events = {}
    crop = plan.crop
    cultivation_type = plan.cultivation_type or resolve_crop_field(
        crop, 'cultivation_type', crop_index,
    )
    if not cultivation_type:
        types = resolve_crop_field(crop, 'cultivation_types', crop_index) or []
        if 'pre_cultivation' in types:
            cultivation_type = 'pre_cultivation'
        elif 'direct_sowing' in types:
            cultivation_type = 'direct_sowing'
    if plan.planting_date:
        if cultivation_type == 'direct_sowing':
            events['sowing'] = plan.planting_date
        elif cultivation_type in ('pre_cultivation', 'purchased_transplant'):
            events['planting'] = plan.planting_date
        propagation = resolve_crop_field(crop, 'propagation_duration_days', crop_index)
        if cultivation_type == 'pre_cultivation' and propagation is not None and propagation > 0:
            events['propagation_start'] = plan.planting_date - timedelta(days=propagation)
    computed_start, computed_end = plan.calculate_effective_harvest_dates(crop_index)
    start = plan.harvest_date or computed_start
    end = plan.harvest_end_date or computed_end
    if start:
        events['harvest_start'] = start
    if end:
        events['harvest_end'] = end
    return events


@transaction.atomic
def generate_plan_tasks(
    plan: PlantingPlan,
    *,
    crop_index: dict[int, Any] | None = None,
    include_harvest_end: bool = False,
) -> list[Task]:
    """Create missing event tasks without rewriting existing dates or user work."""
    if not plan.season_id or plan.season.deleted_at is not None:
        return []
    if plan.season.project_id != plan.project_id:
        return []
    if plan.crop_id and plan.crop.project_id != plan.project_id:
        return []
    Task.objects.filter(
        project_id=plan.project_id, planting_plan=plan, season__isnull=True,
    ).update(season_id=plan.season_id)
    created = []
    events = plan_event_dates(plan, crop_index)
    generate_template_tasks(plan, events)
    for event, due_date in events.items():
        if event == 'harvest_end' and not include_harvest_end:
            continue
        task, was_created = Task.objects.get_or_create(
            project_id=plan.project_id,
            source_key=f'plan:{plan.pk}:event:{event}', occurrence_index=0,
            defaults={
                'planting_plan': plan, 'season_id': plan.season_id, 'crop_id': plan.crop_id,
                'title': AUTOMATIC_TASK_TITLES[event], 'origin': 'automatic',
                'due_date': due_date, 'calculated_due_date': due_date,
            },
        )
        if was_created:
            created.append(task)
    return created


def generate_tasks_for_plans(plans: Iterable[PlantingPlan]) -> int:
    """Share inheritance indexes across a batch, including season copies/seeders."""
    indexes = {}
    count = 0
    for plan in plans:
        if plan.project_id not in indexes:
            indexes[plan.project_id] = build_general_crop_index(plan.project_id)
        count += len(generate_plan_tasks(plan, crop_index=indexes[plan.project_id]))
    return count


def _save_synchronized_task(task: Task, changes: dict[str, Any]) -> None:
    """Record only actual changes, so repeated synchronization adds no history."""
    from farm.history import _serialize_instance, record_entity_revision
    from farm.models import EntityRevision

    changed = [field for field, value in changes.items() if getattr(task, field) != value]
    if not changed:
        return
    for field in changed:
        setattr(task, field, changes[field])
    task.save(update_fields=[*changed, 'updated_at'])
    record_entity_revision(
        project=task.project, entity_type='task', object_id=task.pk,
        action=EntityRevision.ACTION_UPDATED, snapshot=_serialize_instance(task),
        display_name=task.title, changed_fields=changed,
    )


@transaction.atomic
def synchronize_plan_tasks(plan: PlantingPlan) -> None:
    """Reconcile event dates while preserving completed, overridden and deleted work."""
    # Serialize concurrent writes to one plan; the source uniqueness constraint
    # remains the final guard for concurrent task creation. Lock only the plan
    # row: crop and season are nullable, and PostgreSQL rejects FOR UPDATE on
    # the nullable side of the outer joins select_related produces for them.
    plan = (
        PlantingPlan.objects
        .select_related('crop', 'season')
        .select_for_update(of=('self',))
        .get(pk=plan.pk)
    )
    if not plan.season_id or plan.season.deleted_at is not None:
        return
    crop_index = build_general_crop_index(plan.project_id)
    generate_plan_tasks(plan, crop_index=crop_index)
    events = plan_event_dates(plan, crop_index)
    synchronize_template_tasks(plan, events)
    for task in Task.objects.select_for_update().filter(
        project_id=plan.project_id, planting_plan=plan, origin='automatic', deleted_at__isnull=True,
    ):
        prefix = f'plan:{plan.pk}:event:'
        if not task.source_key.startswith(prefix):
            continue
        event = task.source_key[len(prefix):]
        if event not in AUTOMATIC_TASK_TITLES or task.status in ('completed', 'cancelled'):
            continue
        changes = {'season_id': plan.season_id, 'crop_id': plan.crop_id, 'field_id': None}
        if event in events:
            changes['calculated_due_date'] = events[event]
            if not task.due_date_overridden:
                changes['due_date'] = events[event]
        elif not task.due_date_overridden:
            changes['status'] = 'cancelled'
            changes['calculated_due_date'] = None
        _save_synchronized_task(task, changes)


@transaction.atomic
def detach_plan_tasks(plan: PlantingPlan) -> None:
    """Keep task history when a plan is removed; cancel obsolete automatic work."""
    for task in Task.objects.select_for_update().filter(
        project_id=plan.project_id, planting_plan=plan,
    ):
        changes = {'planting_plan_id': None}
        if (task.origin != 'manual' and task.status in ('pending', 'in_progress')
                and not task.due_date_overridden):
            changes['status'] = 'cancelled'
        _save_synchronized_task(task, changes)


def _template_due_date(template: Any, events: dict[str, date]) -> date | None:
    reference = events.get(template.reference_event)
    if reference is None or template.deleted_at is not None:
        return None
    try:
        return reference + timedelta(days=template.day_offset)
    except OverflowError:
        return None


def template_occurrence_dates(template: Any, events: dict[str, date]) -> list[date]:
    """Expand stable occurrence indices from the start event and inclusive end."""
    start = _template_due_date(template, events)
    if start is None:
        return []
    interval = template.repeat_interval_days
    if interval is None:
        return [start]
    if template.repeat_until == 'count':
        count = template.repeat_count or 0
    else:
        end = events.get(template.repeat_until)
        if end is None or end < start:
            return []
        count = (end - start).days // interval + 1
    if count > 1000:
        from rest_framework.exceptions import ValidationError

        raise ValidationError({
            'repeat_interval_days': 'A rule may generate at most 1000 tasks per plan.',
        })
    dates = []
    for index in range(count):
        try:
            dates.append(start + timedelta(days=index * interval))
        except OverflowError:
            break
    return dates


def generate_template_tasks(plan: PlantingPlan, events: dict[str, date]) -> None:
    from farm.models import CropTaskTemplate

    for template in CropTaskTemplate.objects.filter(
        project_id=plan.project_id, crop_id=plan.crop_id, deleted_at__isnull=True,
    ):
        for index, due in enumerate(template_occurrence_dates(template, events)):
            Task.objects.get_or_create(
                project_id=plan.project_id,
                source_key=f'plan:{plan.pk}:template:{template.pk}', occurrence_index=index,
                defaults={
                    'planting_plan': plan, 'season_id': plan.season_id, 'crop_id': plan.crop_id,
                    'template': template, 'title': template.title,
                    'description': template.description, 'origin': 'template',
                    'due_date': due, 'calculated_due_date': due,
                },
            )


def synchronize_template_tasks(plan: PlantingPlan, events: dict[str, date]) -> None:
    generate_template_tasks(plan, events)
    occurrences = {}
    # `of=('self',)`: the template relation is nullable (outer join), see above.
    for task in Task.objects.select_for_update(of=('self',)).select_related('template').filter(
        project_id=plan.project_id, planting_plan=plan, origin='template', deleted_at__isnull=True,
    ):
        if task.status in ('completed', 'cancelled'):
            continue
        template = task.template
        if task.template_id not in occurrences:
            occurrences[task.template_id] = template_occurrence_dates(template, events) if (
                template is not None and template.crop_id == plan.crop_id
                and template.project_id == plan.project_id
            ) else []
        dates = occurrences[task.template_id]
        due = dates[task.occurrence_index] if task.occurrence_index < len(dates) else None
        changes = {'season_id': plan.season_id, 'crop_id': plan.crop_id, 'field_id': None}
        if due is not None:
            changes['calculated_due_date'] = due
            if not task.due_date_overridden:
                changes['due_date'] = due
        elif not task.due_date_overridden:
            changes['status'] = 'cancelled'
            changes['calculated_due_date'] = None
        _save_synchronized_task(task, changes)
