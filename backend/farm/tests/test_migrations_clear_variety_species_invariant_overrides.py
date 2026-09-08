import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
class TestClearVarietySpeciesInvariantOverrides:
    migrate_from = ('farm', '0100_rename_culture_in_stored_json')
    migrate_to = ('farm', '0101_clear_variety_species_invariant_overrides')

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps

        project_model = old_apps.get_model('farm', 'Project')
        crop_model = old_apps.get_model('farm', 'Crop')
        species_model = old_apps.get_model('crops', 'CropSpecies')
        project = project_model.objects.create(name='Migration', slug='migration-invariant')
        species = species_model.objects.create(name='Solanum lycopersicum')

        self.linked_variety_id = crop_model.objects.create(
            name='Tomate', name_normalized='tomate', variety='Matina', variety_normalized='matina',
            project_id=project.id, crop_species_id=species.id,
            crop_family='Solanaceae', nutrient_demand='high', rotation_break_years=4,
        ).id
        self.general_id = crop_model.objects.create(
            name='Tomate', name_normalized='tomate', variety='', variety_normalized=None,
            project_id=project.id, crop_species_id=species.id,
            crop_family='Solanaceae', nutrient_demand='high', rotation_break_years=4,
        ).id
        self.free_text_variety_id = crop_model.objects.create(
            name='Kraut', name_normalized='kraut',
            variety='Freitext', variety_normalized='freitext',
            project_id=project.id, crop_species_id=None,
            crop_family='Brassicaceae', nutrient_demand='medium', rotation_break_years=3,
        ).id

        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_to])

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_clears_only_species_linked_varieties(self):
        apps = self.executor.loader.project_state([self.migrate_to]).apps
        crop_model = apps.get_model('farm', 'Crop')

        linked = crop_model.objects.get(id=self.linked_variety_id)
        assert linked.crop_family == ''
        assert linked.nutrient_demand == ''
        assert linked.rotation_break_years is None

        general = crop_model.objects.get(id=self.general_id)
        assert general.crop_family == 'Solanaceae'
        assert general.nutrient_demand == 'high'
        assert general.rotation_break_years == 4

        free_text = crop_model.objects.get(id=self.free_text_variety_id)
        assert free_text.crop_family == 'Brassicaceae'
        assert free_text.nutrient_demand == 'medium'
        assert free_text.rotation_break_years == 3
