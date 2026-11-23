"""Adopt existing first harvest tasks and add one task per known occurrence."""

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta

from django.apps.registry import Apps
from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.models import F, Q
from django.utils import timezone


def _in_year(year, month_day):
    month, day = month_day
    return date(year, month, min(day, monthrange(year, month)[1]))


@dataclass(frozen=True)
class _Schedule:
    """Calendar rules as of 0162, against the inputs from the historical schema."""

    start: tuple[int, int]
    end: tuple[int, int]
    eligible: date
    clearing: date
    overrides: dict[int, tuple[date, date]]

    @property
    def crosses_year(self):
        return self.end < self.start

    def default_window(self, year):
        start = _in_year(year, self.start)
        end_year = year + self.crosses_year
        if end_year > date.max.year:
            return start, date.max
        end = _in_year(end_year, self.end)
        if self.crosses_year:
            end = min(end, _in_year(end_year, self.start) - timedelta(days=1))
        return start, end

    def eligible_override(self, year):
        override = self.overrides.get(year)
        if override is None:
            return None
        start, end = override
        default_start, default_end = self.default_window(year)
        if max(default_start, self.eligible) > min(default_end, self.clearing):
            return None
        if year > date.min.year and start <= self.default_window(year - 1)[1]:
            return None
        last_day = date(min(date.max.year, year + self.crosses_year), 12, 31)
        if year < date.max.year:
            last_day = min(last_day, _in_year(year + 1, self.start) - timedelta(days=1))
        if (
            max(date(year, 1, 1), self.eligible) <= start <= min(end, max(date(year, 12, 31), default_end))
            and end <= min(last_day, self.clearing)
        ):
            return override
        return None

    def first_day(self, year):
        start, end = self.default_window(year)
        if max(start, self.eligible) > min(end, self.clearing):
            return None
        override = self.eligible_override(year)
        if override:
            previous = self.eligible_override(year - 1)
            following = self.eligible_override(year + 1)
            if (previous is None or previous[1] < override[0]) and (
                following is None or override[1] < following[0]
            ):
                return override[0]
        return max(start, self.eligible)

    def harvest_start_dates(self, seasons):
        expected = {}
        for season_id, start, end in seasons:
            first = max(date.min.year, max(start.year, self.eligible.year) - self.crosses_year)
            last = min(end.year, self.clearing.year)
            for year in range(first, last + 1):
                due = self.first_day(year)
                if due is not None and start <= due <= end:
                    expected.setdefault(year, (due, season_id))
        return expected

    def legacy_harvest_year(self, due):
        if due is None:
            return None
        if self.crosses_year and due.year > date.min.year:
            start, end = self.default_window(due.year - 1)
            if start <= due <= end:
                return due.year - 1
        return due.year


def _schedule_for_plan(plan, generals):
    crop = plan.crop
    general = generals.get(crop.crop_species_id) if (crop.variety or '').strip() else None

    def effective(field):
        own = getattr(crop, field)
        if general is not None and own in (None, '', '-', []):
            return getattr(general, field)
        return own

    if effective('life_cycle') != 'perennial' or not effective('annual_harvest_window'):
        return None
    kind = plan.cultivation_type or effective('cultivation_type')
    if not kind:
        kinds = effective('cultivation_types') or []
        if 'pre_cultivation' in kinds:
            kind = 'pre_cultivation'
        elif 'direct_sowing' in kinds:
            kind = 'direct_sowing'
    actual = plan.actual_sowing_date if kind == 'direct_sowing' else plan.actual_transplanting_date
    planted = actual or plan.planting_date
    eligible_year = planted.year + (effective('first_harvest_delay_years') or 0)
    if eligible_year > date.max.year:
        return None
    start, end = effective('annual_harvest_window').split('/')
    return _Schedule(
        tuple(map(int, start.split('-'))), tuple(map(int, end.split('-'))),
        _in_year(eligible_year, (planted.month, planted.day)),
        plan.clearing_date or plan.harvest_end_date or plan.harvest_date or plan.planting_date,
        {
            int(year): (date.fromisoformat(period['start_date']), date.fromisoformat(period['end_date']))
            for year, period in plan.harvest_window_overrides.items()
        },
    )


def _is_editable(task, today):
    return (
        task.deleted_at is None and not task.due_date_overridden
        and task.status in ('pending', 'in_progress')
        and task.due_date is not None and task.due_date >= today
    )


def _backfill_plan_tasks(plan, schedule, seasons, tasks, today):
    source_key = f'plan:{plan.pk}:event:harvest_start'
    matching = tasks.filter(project_id=plan.project_id, source_key=source_key)
    stored = {task.occurrence_index: task for task in matching}
    expected = schedule.harvest_start_dates(seasons)
    legacy = stored.get(0)
    if legacy is not None:
        year = schedule.legacy_harvest_year(legacy.calculated_due_date or legacy.due_date)
        if year in expected and year not in stored:
            matching.filter(pk=legacy.pk).update(occurrence_index=year)
            stored[year] = stored.pop(0)

    created = []
    for year, (due, season_id) in expected.items():
        task = stored.pop(year, None)
        if task is None:
            created.append(tasks.model(
                project_id=plan.project_id, planting_plan_id=plan.pk, crop_id=plan.crop_id,
                season_id=season_id, title='Start harvesting', origin='automatic',
                source_key=source_key, occurrence_index=year, due_date=due, calculated_due_date=due,
            ))
        elif _is_editable(task, today):
            matching.filter(pk=task.pk).update(
                season_id=season_id, due_date=due, calculated_due_date=due,
            )
    tasks.bulk_create(created, batch_size=500, ignore_conflicts=True)
    obsolete = [task.pk for task in stored.values() if _is_editable(task, today)]
    matching.filter(pk__in=obsolete).update(status='cancelled', calculated_due_date=None)


def backfill_tasks(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    alias = schema_editor.connection.alias
    plans = apps.get_model('farm', 'PlantingPlan').objects.using(alias).filter(
        season__isnull=False, season__deleted_at__isnull=True, season__project_id=F('project_id'),
        crop__project_id=F('project_id'), planting_date__isnull=False, project__is_active=True,
    ).filter(
        Q(crop__life_cycle='perennial') | Q(crop__crop_species__isnull=False),
    )
    tasks = apps.get_model('farm', 'Task').objects.using(alias)
    crops = apps.get_model('farm', 'Crop').objects.using(alias)
    seasons = apps.get_model('farm', 'Season').objects.using(alias)
    today = timezone.localdate()
    project_ids = plans.order_by('project_id').values_list('project_id', flat=True).distinct()
    for project_id in project_ids.iterator():
        generals = {
            crop.crop_species_id: crop for crop in crops.filter(
                project_id=project_id, crop_species__isnull=False,
                variety_normalized__isnull=True, deleted_at__isnull=True,
            ).order_by('-pk')
        }
        periods = list(seasons.filter(
            project_id=project_id, deleted_at__isnull=True,
        ).order_by('start_date', 'pk').values_list('pk', 'start_date', 'end_date'))
        project_plans = plans.filter(project_id=project_id).select_related('crop').order_by('pk')
        for plan in project_plans.iterator(chunk_size=500):
            schedule = _schedule_for_plan(plan, generals)
            if schedule is not None:
                _backfill_plan_tasks(plan, schedule, periods, tasks, today)


class Migration(migrations.Migration):
    dependencies = [('farm', '0161_supplier_package_pricing')]

    # The preceding schema supports the tasks. Keep their history on rollback.
    operations = [migrations.RunPython(backfill_tasks, migrations.RunPython.noop)]
