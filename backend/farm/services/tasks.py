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
    for event, due_date in plan_event_dates(plan, crop_index).items():
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
