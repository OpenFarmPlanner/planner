from __future__ import annotations

from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from crops.models import CropSpecies, CropSpeciesTranslation
from farm.models import Crop, Project
from farm.services.crop_species_coverage import build_crop_species_coverage_report


class AuditCropSpeciesCoverageTests(TestCase):
    def setUp(self) -> None:
        self.project = Project.objects.create(name='Coverage', slug='coverage')
        CropSpecies.objects.all().delete()
        self._create_species('Zucchini', 'Zucchini', regional_names={'switzerland': 'Zucchetti'})
        self._create_species('Grünkohl', 'Kale')

    def _create_species(
        self,
        german_name: str,
        english_name: str,
        *,
        synonyms: list[str] | None = None,
        regional_names: dict[str, str] | None = None,
    ) -> CropSpecies:
        species = CropSpecies.objects.create(name=german_name)
        CropSpeciesTranslation.objects.create(
            species=species,
            language_code='de',
            common_name=german_name,
            synonyms=synonyms or [],
            regional_names=regional_names or {},
        )
        CropSpeciesTranslation.objects.create(
            species=species,
            language_code='en',
            common_name=english_name,
        )
        return species

    def _create_crop(self, name: str) -> Crop:
        return Crop.objects.create(project=self.project, name=name)

    def test_alias_spelling_counts_as_covered(self) -> None:
        self._create_crop('Zucchetti')

        report = build_crop_species_coverage_report()

        self.assertEqual([usage.name for usage in report.matched], ['Zucchetti'])
        self.assertEqual(report.missing, [])
        self.assertEqual(report.borderline, [])

    def test_unknown_name_without_a_neighbour_is_reported_as_missing(self) -> None:
        self._create_crop('Puntarelle')

        report = build_crop_species_coverage_report()

        self.assertEqual([gap.usage.name for gap in report.missing], ['Puntarelle'])
        self.assertEqual(report.borderline, [])

    def test_unknown_name_close_to_a_species_needs_a_manual_decision(self) -> None:
        self._create_crop('Schnittkohl')

        report = build_crop_species_coverage_report()

        self.assertEqual([gap.usage.name for gap in report.borderline], ['Schnittkohl'])
        self.assertIn('Grünkohl', report.borderline[0].near_matches)
        self.assertEqual(report.missing, [])

    def test_report_counts_crops_and_projects_per_name(self) -> None:
        other_project = Project.objects.create(name='Second', slug='second')
        self._create_crop('Puntarelle')
        Crop.objects.create(project=other_project, name='Puntarelle')

        report = build_crop_species_coverage_report()

        gap = report.missing[0]
        self.assertEqual(gap.usage.crop_count, 2)
        self.assertEqual(
            gap.usage.project_ids, (self.project.id, other_project.id),
        )

    def test_project_filter_limits_the_audit(self) -> None:
        other_project = Project.objects.create(name='Second', slug='second')
        self._create_crop('Puntarelle')
        Crop.objects.create(project=other_project, name='Pfefferoni')

        report = build_crop_species_coverage_report([self.project.id])

        self.assertEqual([gap.usage.name for gap in report.missing], ['Puntarelle'])

    def test_command_reports_both_groups_without_changing_data(self) -> None:
        self._create_crop('Puntarelle')
        self._create_crop('Schnittkohl')

        output = StringIO()
        call_command('audit_crop_species_coverage', stdout=output)
        printed = output.getvalue()

        self.assertIn('Checked 2 distinct crop names', printed)
        self.assertIn('Puntarelle', printed)
        self.assertIn('Schnittkohl', printed)
        self.assertIn('similar to: Grünkohl', printed)
        self.assertIn('Nothing was changed', printed)
        self.assertEqual(CropSpecies.objects.count(), 2)
