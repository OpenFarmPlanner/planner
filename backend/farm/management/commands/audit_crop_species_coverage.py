from __future__ import annotations

from django.core.management.base import BaseCommand, CommandParser

from farm.services.crop_species_coverage import (
    CropNameGap,
    CropSpeciesCoverageReport,
    build_crop_species_coverage_report,
)


class Command(BaseCommand):
    help = (
        'Report project crop names that the official crop-species suggestion list does not '
        'know. Read-only: it never creates, renames, or maps a species.'
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            '--project',
            dest='project_ids',
            type=int,
            action='append',
            help='Limit the audit to this project id. Repeat for several projects.',
        )
        parser.add_argument(
            '--show-matched',
            action='store_true',
            help='Also list the crop names that already resolve to a species.',
        )

    def handle(self, *args: object, **options: object) -> None:
        report = build_crop_species_coverage_report(options.get('project_ids'))

        self.stdout.write(
            f'Checked {report.checked_name_count} distinct crop names: '
            f'{len(report.matched)} matched, {len(report.missing)} missing, '
            f'{len(report.borderline)} need a manual decision.'
        )

        self._write_section(
            'Missing from the crop-species library (no similar species found)',
            report.missing,
        )
        self._write_section(
            'Manual decision needed - own species, alias, or variety? '
            'See docs/crop-taxonomy-guidelines.md',
            report.borderline,
        )

        if options.get('show_matched'):
            self.stdout.write('')
            self.stdout.write(self.style.MIGRATE_HEADING('Already covered'))
            for usage in report.matched:
                self.stdout.write(f'  {usage.name} ({usage.crop_count} crops)')

        self._write_summary(report)

    def _write_section(self, title: str, gaps: list[CropNameGap]) -> None:
        self.stdout.write('')
        self.stdout.write(self.style.MIGRATE_HEADING(f'{title}: {len(gaps)}'))
        if not gaps:
            self.stdout.write('  none')
            return
        for gap in gaps:
            projects = ', '.join(str(project_id) for project_id in gap.usage.project_ids)
            self.stdout.write(
                f'  {gap.usage.name} ({gap.usage.crop_count} crops, projects: {projects})'
            )
            if gap.near_matches:
                self.stdout.write(f'      similar to: {", ".join(gap.near_matches)}')

    def _write_summary(self, report: CropSpeciesCoverageReport) -> None:
        self.stdout.write('')
        if not report.missing and not report.borderline:
            self.stdout.write(self.style.SUCCESS('Every project crop name resolves to a species.'))
            return
        self.stdout.write(
            'Nothing was changed. Add confirmed gaps to backend/crops/seed_data.py and sync '
            'them with a migration; decide the manual cases against '
            'docs/crop-taxonomy-guidelines.md first.'
        )
