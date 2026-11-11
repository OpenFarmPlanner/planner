from typing import ClassVar

import pytest
from django.apps.registry import Apps

from farm.tests.migration_base import MigrationTestBase


class GerminationMigrationSetup:
    migrate_from: ClassVar[list[tuple[str, str]]] = [('farm', '0138_crop_site_life_cycle_health')]
    migrate_to: ClassVar[list[tuple[str, str]]] = [('farm', '0139_germination_requirements')]
    rows: ClassVar[dict[str, list[tuple[int, list[str], str, str]]]]

    @classmethod
    def seed_before_migration(cls, apps: Apps) -> None:
        project = apps.get_model('farm', 'Project').objects.create(name='Requirements', slug='requirements')
        species = apps.get_model('crops', 'CropSpecies').objects.create(
            name='Migration requirements species', name_normalized='migration requirements species',
        )
        cls.rows = {}
        cases = [
            ([], '', ''), (['cold', 'light'], 'cold_stratification', 'light'),
            (['frost', 'dark'], 'frost_treatment', 'dark'),
            (['cold', 'frost', 'light'], '', 'light'),
            (['cold', 'light', 'dark'], 'cold_stratification', ''),
            (['cold', 'frost', 'light', 'dark'], '', ''),
        ]
        for model_name in ('Crop', 'PublicCrop'):
            model = apps.get_model('farm', model_name)
            cls.rows[model_name] = []
            for index, (flags, temperature, light) in enumerate(cases):
                kwargs = {'project_id': project.pk} if model_name == 'Crop' else {}
                row = model.objects.create(
                    name=f'Case {index}', name_normalized=f'case {index}',
                    germination_types=flags, germination_pretreatment='Keep original notes',
                    **kwargs,
                )
                cls.rows[model_name].append((row.pk, flags, temperature, light))
            variety = model.objects.create(
                name='Legacy variety', name_normalized='legacy variety',
                variety='Early', variety_normalized='early', crop_species_id=species.pk,
                germination_types=['dark'], germination_pretreatment='Keep original notes',
                **({'project_id': project.pk} if model_name == 'Crop' else {}),
            )
            cls.rows[model_name].append((variety.pk, ['dark'], 'none', 'dark'))


@pytest.mark.django_db
class TestGerminationRequirementsMigration(GerminationMigrationSetup, MigrationTestBase):
    def test_maps_only_unambiguous_axes_and_keeps_all_original_flags(self) -> None:
        for model_name, cases in self.rows.items():
            model = self.new_apps.get_model('farm', model_name)
            for pk, flags, temperature, light in cases:
                row = model.objects.get(pk=pk)
                assert row.germination_types == flags
                assert row.germination_temperature_requirement == temperature
                assert row.germination_light_requirement == light
                assert row.germination_pretreatment == 'Keep original notes'
                assert row.stratification_days_min is None
                assert row.stratification_temperature_max_c is None

    def test_does_not_convert_unknown_empty_lists_to_explicit_none(self) -> None:
        for model_name, cases in self.rows.items():
            row = self.new_apps.get_model('farm', model_name).objects.get(pk=cases[0][0])
            assert row.germination_temperature_requirement == ''
            assert row.germination_light_requirement == ''


@pytest.mark.django_db(transaction=True)
class TestGerminationRequirementsReverse(GerminationMigrationSetup, MigrationTestBase):
    def test_reverse_retains_the_legacy_flags_and_notes(self) -> None:
        apps = self.migrate_to_state(self.migrate_from)
        for model_name, cases in self.rows.items():
            model = apps.get_model('farm', model_name)
            for pk, flags, _, _ in cases:
                row = model.objects.get(pk=pk)
                assert row.germination_types == flags
                assert row.germination_pretreatment == 'Keep original notes'
