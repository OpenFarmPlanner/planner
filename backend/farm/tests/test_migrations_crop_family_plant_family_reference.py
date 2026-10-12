import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from conftest import ensure_seeded_plant_families


@pytest.mark.django_db(transaction=True)
class TestCropFamilyPlantFamilyReference:
    migrate_from = ('farm', '0111_project_demo_seeded_at')
    migrate_to = ('farm', '0112_crop_family_plant_family_reference')

    def setup_method(self):
        # The previous test's flush removed the families crops.0019 seeded.
        ensure_seeded_plant_families()
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps

        project = old_apps.get_model('farm', 'Project').objects.create(name='P', slug='p')
        crop_model = old_apps.get_model('farm', 'Crop')
        public_crop_model = old_apps.get_model('farm', 'PublicCrop')
        proposal_model = old_apps.get_model('farm', 'PublicCropChangeProposal')

        def crop(name: str, family: str, **extra) -> int:
            return crop_model.objects.create(
                project=project, name=name, name_normalized=name.lower(),
                crop_family=family, **extra,
            ).id

        self.crop_ids = {
            'Kreuzblütler': crop('Kohlrabi', 'Kreuzblütler'),
            ' brassicaceae ': crop('Kohl', ' brassicaceae '),
            'Kohlgewächse': crop('Rettich', 'Kohlgewächse'),
            'Leguminosen': crop('Bohne', 'Leguminosen'),
            'Schmetterlingsblütler': crop('Erbse', 'Schmetterlingsblütler'),
            'Gänsefußgewächse': crop('Mangold', 'Gänsefußgewächse'),
            'Zwiebelgewächse': crop('Zwiebel', 'Zwiebelgewächse'),
            'Alliaceae': crop('Lauch', 'Alliaceae'),
            'Umbelliferae': crop('Karotte', 'Umbelliferae'),
            'Compositae': crop('Salat', 'Compositae'),
            'Valerianaceae': crop('Feldsalat', 'Valerianaceae'),
            'Kreuzblütler (Brassicaceae)': crop('Rucola', 'Kreuzblütler (Brassicaceae)'),
            'Liliengewächse': crop('Spargel', 'Liliengewächse'),
            'Nachtschatten / Kürbis': crop('Mix', 'Nachtschatten / Kürbis'),
            'deleted': crop(
                'Alt', 'Nachtschattengewächse', deleted_at='2026-01-01T00:00:00Z',
            ),
            'empty': crop('Leer', ''),
        }
        self.public_ids = {
            'Kreuzblütengewächse': public_crop_model.objects.create(
                name='Kohl', name_normalized='kohl', status='published',
                crop_family='Kreuzblütengewächse',
            ).id,
            'Phantasie': public_crop_model.objects.create(
                name='X', name_normalized='x', status='published', crop_family='Phantasie',
            ).id,
        }
        public_entry_id = self.public_ids['Kreuzblütengewächse']
        self.proposal_ids = {
            'mapped': proposal_model.objects.create(
                public_crop_id=public_entry_id, kind='edit', status='pending',
                proposed_data={'crop_family': 'Hülsenfrüchtler', 'notes': 'x'},
            ).id,
            'unmapped': proposal_model.objects.create(
                public_crop_id=public_entry_id, kind='edit', status='pending',
                proposed_data={'crop_family': 'Phantasie', 'notes': 'y'},
            ).id,
        }

        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_to])

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _apps(self):
        return self.executor.loader.project_state([self.migrate_to]).apps

    def test_known_spellings_are_mapped_and_the_original_text_is_kept(self):
        crop_model = self._apps().get_model('farm', 'Crop')
        expected = {
            'Kreuzblütler': 'Brassicaceae',
            ' brassicaceae ': 'Brassicaceae',
            'Kohlgewächse': 'Brassicaceae',
            'Leguminosen': 'Fabaceae',
            'Schmetterlingsblütler': 'Fabaceae',
            'Gänsefußgewächse': 'Amaranthaceae',
            'Zwiebelgewächse': 'Amaryllidaceae',
            'Alliaceae': 'Amaryllidaceae',
            'Umbelliferae': 'Apiaceae',
            'Compositae': 'Asteraceae',
            'Valerianaceae': 'Caprifoliaceae',
            'Kreuzblütler (Brassicaceae)': 'Brassicaceae',
            'deleted': 'Solanaceae',
        }
        for label, family in expected.items():
            row = crop_model._base_manager.get(id=self.crop_ids[label])
            assert row.crop_family_id == family, label
        kohlrabi = crop_model._base_manager.get(id=self.crop_ids['Kreuzblütler'])
        assert kohlrabi.legacy_crop_family == 'Kreuzblütler'

    def test_unmapped_values_stay_empty_and_keep_their_text(self):
        crop_model = self._apps().get_model('farm', 'Crop')
        for label in ('Liliengewächse', 'Nachtschatten / Kürbis'):
            row = crop_model._base_manager.get(id=self.crop_ids[label])
            assert row.crop_family_id is None
            assert row.legacy_crop_family == label
        assert crop_model._base_manager.get(id=self.crop_ids['empty']).crop_family_id is None

    def test_public_entries_follow_the_same_rules(self):
        public_crop_model = self._apps().get_model('farm', 'PublicCrop')
        mapped = public_crop_model.objects.get(id=self.public_ids['Kreuzblütengewächse'])
        assert mapped.crop_family_id == 'Brassicaceae'
        unmapped = public_crop_model.objects.get(id=self.public_ids['Phantasie'])
        assert unmapped.crop_family_id is None
        assert unmapped.legacy_crop_family == 'Phantasie'

    def test_pending_proposals_are_rekeyed_or_lose_only_the_unmappable_family(self):
        proposal_model = self._apps().get_model('farm', 'PublicCropChangeProposal')
        mapped = proposal_model.objects.get(id=self.proposal_ids['mapped'])
        assert mapped.proposed_data == {'crop_family': 'Fabaceae', 'notes': 'x'}
        unmapped = proposal_model.objects.get(id=self.proposal_ids['unmapped'])
        assert unmapped.proposed_data == {'notes': 'y'}


@pytest.mark.django_db(transaction=True)
def test_unmapped_values_are_printed_with_their_row_ids(capsys):
    ensure_seeded_plant_families()
    executor = MigrationExecutor(connection)
    executor.migrate([('farm', '0111_project_demo_seeded_at')])
    old_apps = executor.loader.project_state([('farm', '0111_project_demo_seeded_at')]).apps
    project = old_apps.get_model('farm', 'Project').objects.create(name='Q', slug='q')
    crop_model = old_apps.get_model('farm', 'Crop')
    ids = [
        crop_model.objects.create(
            project=project, name=name, name_normalized=name.lower(), crop_family='Liliengewächse',
        ).id
        for name in ('Spargel', 'Spargel grün')
    ]
    capsys.readouterr()
    try:
        executor.loader.build_graph()
        executor.migrate([('farm', '0112_crop_family_plant_family_reference')])
        output = capsys.readouterr().out
        assert "Unmapped Crop.crop_family 'Liliengewächse'" in output
        assert str(ids) in output
    finally:
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())
