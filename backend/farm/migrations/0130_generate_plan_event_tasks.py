"""Backfill persisted events from the former, purely derived overview."""

from datetime import timedelta
from typing import Any

from django.apps.registry import Apps
from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.models import F

TITLES = {
    'propagation_start': 'Start propagation',
    'sowing': 'Direct sowing',
    'planting': 'Transplant',
    'harvest_start': 'Start harvesting',
}


def backfill_tasks(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    Plan = apps.get_model('farm', 'PlantingPlan')
    Crop = apps.get_model('farm', 'Crop')
    Task = apps.get_model('farm', 'Task')
    alias = schema_editor.connection.alias
    plans = Plan.objects.using(alias).filter(
        season__isnull=False, season__deleted_at__isnull=True,
        season__project_id=F('project_id'), project__is_active=True,
        project__deleted_at__isnull=True,
    )
    tasks = Task.objects.using(alias)
    projects = plans.order_by('project_id').values_list('project_id', flat=True).distinct()
    for project_id in projects.iterator():
        generals = {
            crop.crop_species_id: crop
            for crop in Crop.objects.using(alias).filter(
                project_id=project_id, crop_species__isnull=False,
                variety_normalized__isnull=True, deleted_at__isnull=True,
            ).order_by('-pk')
        }
        batch = []
        for plan in plans.filter(project_id=project_id).select_related('crop').iterator(chunk_size=500):
            crop = plan.crop
            if crop is not None and crop.project_id != project_id:
                continue

            def effective(field: str) -> Any:
                if crop is None:
                    return None
                value = getattr(crop, field)
                if value not in (None, '', [], '-'):
                    return value
                if (crop.variety or '').strip() and crop.crop_species_id in generals:
                    return getattr(generals[crop.crop_species_id], field)
                return value

            kind = plan.cultivation_type or effective('cultivation_type')
            if not kind:
                types = effective('cultivation_types') or []
                kind = 'pre_cultivation' if 'pre_cultivation' in types else (
                    'direct_sowing' if 'direct_sowing' in types else ''
                )
            events = {}
            if plan.planting_date:
                if kind == 'direct_sowing':
                    events['sowing'] = plan.planting_date
                elif kind in ('pre_cultivation', 'purchased_transplant'):
                    events['planting'] = plan.planting_date
                propagation = effective('propagation_duration_days')
                if kind == 'pre_cultivation' and propagation is not None and propagation > 0:
                    events['propagation_start'] = plan.planting_date - timedelta(days=propagation)
            harvest = plan.harvest_date
            growth = effective('growth_duration_days')
            if harvest is None and plan.planting_date and growth is not None:
                harvest = plan.planting_date + timedelta(days=growth)
            if harvest:
                events['harvest_start'] = harvest
            for event, due_date in events.items():
                batch.append(Task(
                    project_id=project_id, season_id=plan.season_id, crop_id=plan.crop_id,
                    planting_plan_id=plan.pk, title=TITLES[event], origin='automatic',
                    source_key=f'plan:{plan.pk}:event:{event}', occurrence_index=0,
                    due_date=due_date, calculated_due_date=due_date,
                ))
            if len(batch) >= 500:
                tasks.bulk_create(batch, batch_size=500, ignore_conflicts=True)
                batch.clear()
        if batch:
            tasks.bulk_create(batch, batch_size=500, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [('farm', '0129_add_task_field')]
    # Keep generated work on rollback: the preceding schema already supports
    # these rows, and deleting them would lose completed work and manual edits.
    operations = [migrations.RunPython(backfill_tasks, migrations.RunPython.noop)]
