"""Persist dated planting-plan events as independently completable tasks."""

import json
from collections.abc import Iterable
from datetime import date, timedelta
from typing import Any

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import F, Q, QuerySet
from django.utils import timezone

from farm.models import EntityRevision, PlantingPlan, Project, Season, Task
from farm.services.crop_inheritance import (
    build_general_crop_index,
    plan_cultivation_type,
    resolve_crop_field,
)
from farm.services.seasonal_harvest import RecurringHarvestSchedule, recurring_harvest_schedule

AUTOMATIC_TASK_TITLES = {
    'propagation_start': 'Start propagation',
    'sowing': 'Direct sowing',
    'planting': 'Transplant',
    'harvest_start': 'Start harvesting',
    'harvest_end': 'Finish harvesting',
}


def _automatic_event_title(
    plan: PlantingPlan, event: str, crop_index: dict[int, Any] | None,
) -> str:
    if event == 'sowing' and plan_cultivation_type(plan, crop_index) != 'direct_sowing':
        return 'Sowing'
    return AUTOMATIC_TASK_TITLES[event]


def plan_event_dates(
    plan: PlantingPlan, crop_index: dict[int, Any] | None = None,
) -> dict[str, date]:
    """Resolve known events from the same effective timing values as the plan."""
    crop = plan.crop
    cultivation_type = plan_cultivation_type(plan, crop_index)
    events = {}
    if cultivation_type == 'pre_cultivation':
        if plan.planned_propagation_start_date is not None:
            events['propagation_start'] = plan.planned_propagation_start_date
        if plan.planned_sowing_date is not None:
            events['sowing'] = plan.planned_sowing_date
    if plan.planting_date:
        if cultivation_type == 'direct_sowing':
            events['sowing'] = plan.planting_date
        elif cultivation_type in ('pre_cultivation', 'purchased_transplant'):
            events['planting'] = plan.planting_date
        propagation = resolve_crop_field(crop, 'propagation_duration_days', crop_index)
        if (
            cultivation_type == 'pre_cultivation' and 'propagation_start' not in events
            and propagation is not None and propagation > 0
        ):
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
    synchronize_harvest: bool = False,
) -> list[Task]:
    """Create missing event tasks without rewriting existing dates or user work."""
    if not plan.season_id or plan.season.deleted_at is not None:
        return []
    if plan.season.project_id != plan.project_id:
        return []
    if plan.crop_id and plan.crop.project_id != plan.project_id:
        return []
    unassigned = list(Task.objects.select_for_update().filter(
        project_id=plan.project_id, planting_plan=plan, season__isnull=True,
    ))
    if unassigned:
        Task.objects.filter(pk__in=[task.pk for task in unassigned]).update(
            season_id=plan.season_id,
        )
        for task in unassigned:
            task.season_id = plan.season_id
            _record_task_revision(
                task, plan.project, action=EntityRevision.ACTION_UPDATED,
                changed_fields=['season_id'],
            )
    created = []
    events = plan_event_dates(plan, crop_index)
    generate_template_tasks(plan, events)
    schedule = recurring_harvest_schedule(plan, crop_index)
    for event, due_date in events.items():
        if (event == 'harvest_end' and not include_harvest_end) or (
            event == 'harvest_start' and schedule is not None
        ):
            continue
        task = _create_automatic_task(
            plan, event, due_date, plan.season_id, 0, crop_index,
        )
        if task is not None:
            created.append(task)
    if schedule is not None:
        created.extend(_reconcile_harvest_tasks(
            plan, schedule, preserve_before=timezone.localdate() if synchronize_harvest else None,
        ))
    return created


def _create_automatic_task(
    plan: PlantingPlan, event: str, due_date: date, season_id: int,
    occurrence_index: int, crop_index: dict[int, Any] | None = None,
) -> Task | None:
    source_key = f'plan:{plan.pk}:event:{event}'
    if event == 'harvest_start' and occurrence_index == 0:
        history = Task.objects.filter(
            project_id=plan.project_id, source_key=source_key, occurrence_index__gt=0,
        ).filter(Q(due_date=due_date) | Q(calculated_due_date=due_date)).filter(
            Q(deleted_at__isnull=False) | Q(due_date_overridden=True)
            | Q(status__in=('completed', 'cancelled')),
        )
        if history.exists():
            return None
    task, created = Task.objects.get_or_create(
        project_id=plan.project_id,
        source_key=source_key, occurrence_index=occurrence_index,
        defaults={
            'planting_plan': plan, 'season_id': season_id, 'crop_id': plan.crop_id,
            'title': _automatic_event_title(plan, event, crop_index), 'origin': 'automatic',
            'due_date': due_date, 'calculated_due_date': due_date,
        },
    )
    if not created:
        return None
    _record_task_revision(
        task, plan.project, action=EntityRevision.ACTION_CREATED, changed_fields=['created'],
    )
    return task


def _can_reschedule_harvest(task: Task, preserve_before: date | None) -> bool:
    return bool(
        preserve_before is not None and task.deleted_at is None and not task.due_date_overridden
        and task.status in ('pending', 'in_progress')
        and task.due_date is not None and task.due_date >= preserve_before
    )


def _harvest_task_dates(
    plan: PlantingPlan, schedule: RecurringHarvestSchedule,
) -> dict[int, tuple[date, int]]:
    if schedule.eligible_from is None or schedule.occupied_until is None:
        return {}
    seasons = Season.objects.filter(
        project_id=plan.project_id, start_date__lte=schedule.occupied_until,
        end_date__gte=schedule.eligible_from,
    ).order_by('start_date', 'pk')
    return schedule.harvest_start_dates(
        (season.pk, season.start_date, season.end_date) for season in seasons
    )


def _adopt_legacy_harvest_task(
    stored: dict[int, Task], expected: dict[int, tuple[date, int]],
    schedule: RecurringHarvestSchedule,
) -> None:
    legacy = stored.get(0)
    if legacy is None:
        return
    year = schedule.legacy_harvest_year(legacy.calculated_due_date or legacy.due_date)
    if year in expected and year not in stored:
        # Pin the identity even for protected rows so a later crop-window edit
        # cannot reinterpret a January task as work for the following occurrence.
        Task.objects.filter(pk=legacy.pk).update(occurrence_index=year)
        legacy.occurrence_index = year
        _record_task_revision(
            legacy, legacy.project, action=EntityRevision.ACTION_UPDATED,
            changed_fields=['occurrence_index'],
        )
        stored[year] = stored.pop(0)


def _reconcile_harvest_tasks(
    plan: PlantingPlan, schedule: RecurringHarvestSchedule, *, preserve_before: date | None,
    new_season_id: int | None = None, fill_past_occurrences: bool = False,
    fill_past_season_id: int | None = None,
) -> list[Task]:
    expected = _harvest_task_dates(plan, schedule)
    stored = {
        task.occurrence_index: task for task in Task.objects.select_related('season').filter(
            project_id=plan.project_id, source_key=f'plan:{plan.pk}:event:harvest_start',
        ).select_for_update(of=('self',))
    }
    _adopt_legacy_harvest_task(stored, expected, schedule)
    if new_season_id is not None:
        expected = {year: dates for year, dates in expected.items() if dates[1] == new_season_id}

    create_on_or_after = preserve_before or date.min
    if fill_past_occurrences or new_season_id is not None:
        create_on_or_after = date.min
    created = []
    for year, (due, season_id) in expected.items():
        task = stored.pop(year, None)
        if task is None:
            if due >= create_on_or_after or season_id == fill_past_season_id:
                task = _create_automatic_task(plan, 'harvest_start', due, season_id, year)
                if task is not None:
                    created.append(task)
        elif _can_reschedule_harvest(task, preserve_before):
            _save_synchronized_task(task, {
                'due_date': due, 'calculated_due_date': due, 'season_id': season_id,
                'crop_id': plan.crop_id, 'occurrence_index': year,
            })
    for task in stored.values() if new_season_id is None else ():
        hidden_season = task.season is not None and task.season.deleted_at is not None
        if not hidden_season and _can_reschedule_harvest(task, preserve_before):
            _save_synchronized_task(task, {'status': 'cancelled', 'calculated_due_date': None})
    return created


def _reconcile_one_time_harvest(
    plan: PlantingPlan, crop_index: dict[int, Any], preserve_before: date,
) -> None:
    due = plan_event_dates(plan, crop_index).get('harvest_start')
    if due is not None and due >= preserve_before:
        _create_automatic_task(plan, 'harvest_start', due, plan.season_id, 0, crop_index)
    for task in Task.objects.select_for_update().filter(
        project_id=plan.project_id, occurrence_index__gt=0,
        source_key=f'plan:{plan.pk}:event:harvest_start',
    ):
        if _can_reschedule_harvest(task, preserve_before):
            _save_synchronized_task(task, {'status': 'cancelled', 'calculated_due_date': None})


@transaction.atomic
def synchronize_recurring_harvest_tasks(
    plans: QuerySet[PlantingPlan], *, new_season_id: int | None = None,
    cancel_obsolete: bool = False, fill_past_occurrences: bool = False,
    fill_past_season_id: int | None = None,
) -> None:
    """Reconcile harvest starts when a season, crop default or override changes."""
    indexes = {}
    preserve_before = timezone.localdate()
    if not cancel_obsolete:
        plans = plans.filter(
            Q(crop__life_cycle='perennial')
            | Q(crop__crop_species_id__isnull=False, crop__variety_normalized__isnull=False),
        )
    plans = plans.filter(
        season__isnull=False, season__deleted_at__isnull=True, season__project_id=F('project_id'),
        crop__project_id=F('project_id'), planting_date__isnull=False,
    ).select_related('crop').order_by('pk').select_for_update(of=('self',))
    for plan in plans.iterator(chunk_size=100):
        if plan.project_id not in indexes:
            indexes[plan.project_id] = build_general_crop_index(plan.project_id)
        schedule = recurring_harvest_schedule(plan, indexes[plan.project_id])
        if schedule is not None:
            _reconcile_harvest_tasks(
                plan, schedule, preserve_before=preserve_before, new_season_id=new_season_id,
                fill_past_occurrences=fill_past_occurrences,
                fill_past_season_id=fill_past_season_id,
            )
        elif cancel_obsolete:
            _reconcile_one_time_harvest(plan, indexes[plan.project_id], preserve_before)


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
    changed = [field for field, value in changes.items() if getattr(task, field) != value]
    if not changed:
        return
    for field in changed:
        setattr(task, field, changes[field])
    task.save(update_fields=[*changed, 'updated_at'])
    _record_task_revision(
        task, task.project, action=EntityRevision.ACTION_UPDATED, changed_fields=changed,
    )


def _record_task_revision(
    task: Task, project: Project, *, action: str, changed_fields: list[str],
) -> None:
    from farm.history import record_entity_revision

    values = {field.attname: getattr(task, field.attname) for field in task._meta.concrete_fields}
    values['_project_version_internal'] = True
    record_entity_revision(
        project=project, entity_type='task', object_id=task.pk, action=action,
        snapshot=json.loads(json.dumps(values, cls=DjangoJSONEncoder)),
        display_name=task.title, changed_fields=changed_fields,
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
    generate_plan_tasks(plan, crop_index=crop_index, synchronize_harvest=True)
    events = plan_event_dates(plan, crop_index)
    schedule = recurring_harvest_schedule(plan, crop_index)
    synchronize_template_tasks(plan, events)
    _synchronize_automatic_tasks(plan, events, crop_index, schedule is not None)


def _synchronize_automatic_tasks(
    plan: PlantingPlan, events: dict[str, date], crop_index: dict[int, Any], recurring: bool,
) -> None:
    preserve_before = timezone.localdate()
    prefix = f'plan:{plan.pk}:event:'
    for task in Task.objects.select_for_update().filter(
        project_id=plan.project_id, planting_plan=plan, origin='automatic', deleted_at__isnull=True,
    ):
        if not task.source_key.startswith(prefix):
            continue
        event = task.source_key[len(prefix):]
        if event not in AUTOMATIC_TASK_TITLES or task.status in ('completed', 'cancelled'):
            continue
        if event == 'harvest_start' and (recurring or task.occurrence_index > 0):
            if not recurring and _can_reschedule_harvest(task, preserve_before):
                _save_synchronized_task(task, {'status': 'cancelled', 'calculated_due_date': None})
            continue
        changes = {'season_id': plan.season_id, 'crop_id': plan.crop_id, 'field_id': None}
        if event in events:
            if event == 'sowing' and task.title in ('Sowing', AUTOMATIC_TASK_TITLES['sowing']):
                changes['title'] = _automatic_event_title(plan, event, crop_index)
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
            task, created = Task.objects.get_or_create(
                project_id=plan.project_id,
                source_key=f'plan:{plan.pk}:template:{template.pk}', occurrence_index=index,
                defaults={
                    'planting_plan': plan, 'season_id': plan.season_id, 'crop_id': plan.crop_id,
                    'template': template, 'title': template.title,
                    'description': template.description, 'origin': 'template',
                    'due_date': due, 'calculated_due_date': due,
                },
            )
            if created:
                _record_task_revision(
                    task, plan.project, action=EntityRevision.ACTION_CREATED,
                    changed_fields=['created'],
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
