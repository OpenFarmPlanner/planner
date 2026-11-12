"""Companion planting: neighbour relations, the planning check and the spreadsheet import."""

from datetime import date

from django.utils import timezone

from accounts.trust import grant_established_trust
from crops.models import CropSpecies
from farm.models import Bed, Crop, CropCompanion, EntityRevision, PlantingPlan, Project, PublicCrop
from farm.tests.api_base import ProjectApiTestCase

COMPANIONS_URL = '/openfarmplanner/api/crop-companions/'
PLANS_URL = '/openfarmplanner/api/planting-plans/'
PREVIEW_URL = '/openfarmplanner/api/crops/import/preview/'
APPLY_URL = '/openfarmplanner/api/crops/import/apply/'


class CropCompanionTestCase(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.tomato = Crop.objects.create(name='Tomate', project=self.project)
        self.potato = Crop.objects.create(name='Kartoffel', project=self.project, crop_family_id='Solanaceae')
        self.cabbage = Crop.objects.create(name='Kohlrabi', project=self.project, crop_family_id='Brassicaceae')

    def relate(self, first: Crop, second: Crop, kind: str = CropCompanion.KIND_BAD) -> CropCompanion:
        low, high = sorted((first, second), key=lambda crop: crop.id)
        return CropCompanion.objects.create(project=self.project, crop=low, companion_crop=high, kind=kind)

    def plan(self, crop: Crop, start: date, end: date, bed: Bed | None = None) -> PlantingPlan:
        plan = PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=bed or self.bed, planting_date=start, area_usage_sqm=1,
        )
        # save() derives the harvest dates from the crop's timing; these crops
        # have none, so the period is set directly.
        PlantingPlan.objects.filter(pk=plan.pk).update(harvest_date=end, harvest_end_date=end)
        plan.refresh_from_db()
        return plan


class CropCompanionApiTests(CropCompanionTestCase):
    def test_pair_is_stored_once_in_canonical_order_and_listed_for_both_crops(self):
        response = self.client.post(COMPANIONS_URL, {
            'crop': self.potato.id, 'companion_crop': self.tomato.id,
            'kind': 'bad', 'reason': 'shared_pests_diseases', 'note': 'Kraut- und Braunfäule',
        }, format='json')

        self.assertEqual(response.status_code, 201, response.data)
        relation = CropCompanion.objects.get()
        self.assertEqual((relation.crop_id, relation.companion_crop_id), (self.tomato.id, self.potato.id))
        for crop in (self.tomato, self.potato):
            listed = self.client.get(COMPANIONS_URL, {'crop': crop.id}).data
            self.assertEqual([row['id'] for row in listed], [relation.id])
        self.assertEqual(self.client.get(COMPANIONS_URL, {'crop': self.cabbage.id}).data, [])

    def test_the_same_pair_in_the_other_order_is_a_duplicate(self):
        self.relate(self.tomato, self.potato)

        response = self.client.post(COMPANIONS_URL, {
            'crop': self.potato.id, 'companion_crop': self.tomato.id, 'kind': 'good',
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('companion', response.data)
        self.assertEqual(CropCompanion.objects.count(), 1)

    def test_a_variety_cannot_hold_neighbours(self):
        variety = Crop.objects.create(name='Tomate', variety='Ochsenherz', project=self.project)

        response = self.client.post(COMPANIONS_URL, {
            'crop': variety.id, 'companion_crop': self.potato.id, 'kind': 'bad',
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('crop', response.data)

    def test_exactly_one_target_is_required(self):
        for payload in (
            {'crop': self.tomato.id, 'kind': 'bad'},
            {'crop': self.tomato.id, 'companion_crop': self.potato.id, 'companion_text': 'Salbei', 'kind': 'bad'},
        ):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post(COMPANIONS_URL, payload, format='json').status_code, 400)

    def test_family_and_free_text_targets(self):
        family = self.client.post(COMPANIONS_URL, {
            'crop': self.potato.id, 'companion_family': 'Brassicaceae', 'kind': 'bad',
        }, format='json')
        text = self.client.post(COMPANIONS_URL, {
            'crop': self.potato.id, 'companion_text': '  Kräuter (Dill, Basilikum) ', 'kind': 'good',
        }, format='json')

        self.assertEqual(family.status_code, 201, family.data)
        self.assertEqual(text.status_code, 201, text.data)
        self.assertEqual(text.data['companion_text'], 'Kräuter (Dill, Basilikum)')

    def test_a_crop_of_another_project_is_rejected(self):
        other_project = Project.objects.create(name='Other', slug='other')
        foreign = Crop.objects.create(name='Fremd', project=other_project)

        response = self.client.post(COMPANIONS_URL, {
            'crop': self.tomato.id, 'companion_crop': foreign.id, 'kind': 'bad',
        }, format='json')

        self.assertEqual(response.status_code, 400)

    def test_relations_of_a_soft_deleted_crop_are_hidden(self):
        self.relate(self.tomato, self.potato)
        self.potato.deleted_at = timezone.now()
        self.potato.save(update_fields=['deleted_at'])

        self.assertEqual(self.client.get(COMPANIONS_URL).data, [])

    def test_create_and_delete_are_recorded_in_the_history(self):
        response = self.client.post(COMPANIONS_URL, {
            'crop': self.tomato.id, 'companion_crop': self.potato.id, 'kind': 'bad',
        }, format='json')
        self.client.delete(f"{COMPANIONS_URL}{response.data['id']}/")

        actions = list(
            self.project.entity_revisions.filter(entity_type='crop_companion')
            .order_by('created_at').values_list('action', flat=True)
        )
        self.assertEqual(actions, ['created', 'deleted'])


class CompanionPlanningCheckTests(CropCompanionTestCase):
    def findings_of(self, plan: PlantingPlan) -> list[dict]:
        response = self.client.get(f'{PLANS_URL}{plan.id}/')
        self.assertEqual(response.status_code, 200)
        return response.data['companion_findings']

    def test_bad_neighbours_overlapping_on_the_same_bed_are_reported_both_ways(self):
        self.relate(self.tomato, self.potato)
        tomato_plan = self.plan(self.tomato, date(2026, 5, 1), date(2026, 9, 30))
        potato_plan = self.plan(self.potato, date(2026, 4, 1), date(2026, 7, 31))

        tomato_findings = self.findings_of(tomato_plan)
        self.assertEqual(len(tomato_findings), 1)
        self.assertEqual(tomato_findings[0]['kind'], 'bad')
        self.assertEqual(tomato_findings[0]['other_plan_id'], potato_plan.id)
        self.assertEqual([f['other_plan_id'] for f in self.findings_of(potato_plan)], [tomato_plan.id])

    def test_no_finding_without_overlap_or_on_another_bed(self):
        self.relate(self.tomato, self.potato)
        other_bed = Bed.objects.create(name='Beet 2', field=self.field, area_sqm=10, project=self.project)
        tomato_plan = self.plan(self.tomato, date(2026, 5, 1), date(2026, 6, 30))
        self.plan(self.potato, date(2026, 7, 1), date(2026, 9, 30))
        self.plan(self.potato, date(2026, 5, 1), date(2026, 6, 30), bed=other_bed)

        self.assertEqual(self.findings_of(tomato_plan), [])

    def test_a_variety_uses_the_relations_of_its_kultur(self):
        self.relate(self.tomato, self.potato)
        variety = Crop.objects.create(name='Tomate', variety='Ochsenherz', project=self.project)
        variety_plan = self.plan(variety, date(2026, 5, 1), date(2026, 9, 30))
        self.plan(self.potato, date(2026, 4, 1), date(2026, 7, 31))

        self.assertEqual([f['kind'] for f in self.findings_of(variety_plan)], ['bad'])

    def test_a_family_relation_matches_every_crop_of_that_family(self):
        CropCompanion.objects.create(
            project=self.project, crop=self.potato, companion_family_id='Brassicaceae', kind='bad',
        )
        cabbage_plan = self.plan(self.cabbage, date(2026, 5, 1), date(2026, 8, 31))
        self.plan(self.potato, date(2026, 4, 1), date(2026, 7, 31))

        findings = self.findings_of(cabbage_plan)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]['via_family_key'], 'Brassicaceae')

    def test_a_family_relation_is_reported_once_for_two_plans_of_the_same_kultur(self):
        CropCompanion.objects.create(
            project=self.project, crop=self.potato, companion_family_id='Solanaceae', kind='bad',
        )
        first = self.plan(self.potato, date(2026, 5, 1), date(2026, 8, 31))
        self.plan(self.potato, date(2026, 6, 1), date(2026, 9, 30))

        self.assertEqual(len(self.findings_of(first)), 1)

    def test_the_live_check_reports_neighbours_of_an_unsaved_plan(self):
        self.relate(self.tomato, self.potato)
        self.plan(self.potato, date(2026, 4, 1), date(2026, 7, 31))

        response = self.client.get(f'{PLANS_URL}rotation-check/', {
            'crop_id': self.tomato.id, 'bed_id': self.bed.id,
            'planting_date': '2026-05-01', 'end_date': '2026-09-30',
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual([f['kind'] for f in response.data['companion_findings']], ['bad'])


class CompanionImportTests(CropCompanionTestCase):
    def test_placeholder_only_neighbours_are_ignored_in_preview_and_apply(self) -> None:
        placeholders = ['#', '-', '?', '...', '—', '_', '/', '(?)', '※', '✓', '# ? – /']
        items = [{'name': f' {name} ', 'note': 'Wurzelraum'} for name in placeholders]
        rows = [{'name': 'Gurke', 'good_companions': items, 'bad_companions': items}]

        preview = self.client.post(PREVIEW_URL, rows, format='json')

        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertIsNone(preview.data['results'][0].get('companions'))

        response = self.client.post(APPLY_URL, {'items': rows}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['companions'], {
            'created': 0, 'unresolved': [], 'conflicts': [],
        })
        self.assertFalse(CropCompanion.objects.exists())

    def test_placeholders_are_filtered_without_changing_real_neighbours(self) -> None:
        names = ['Pak-Choi', 'Épinard', '小白菜', '123']
        items = [
            {'name': name, 'reason': 'competition', 'note': 'Wurzelraum'}
            for name in ['#', *names, '?']
        ]
        rows = [{'name': 'Gurke', 'good_companions': items}]

        preview = self.client.post(PREVIEW_URL, rows, format='json')

        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data['results'][0]['companions'], {
            'count': len(names), 'unresolved': names,
        })

        response = self.client.post(APPLY_URL, {'items': rows}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['companions'], {
            'created': len(names), 'unresolved': sorted(names), 'conflicts': [],
        })
        self.assertCountEqual(
            CropCompanion.objects.values_list('companion_text', 'reason', 'note'),
            [(name, 'competition', 'Wurzelraum') for name in names],
        )

    def test_apply_links_names_to_kulturen_families_or_free_text(self):
        rows = [
            {
                'name': 'Gurke',
                'good_companions': [{'name': 'Dill', 'reason': 'pest_control', 'note': ''}],
                'bad_companions': [
                    {'name': 'Tomate', 'note': 'Luftfeuchte'},
                    {'name': 'Kreuzblütler', 'note': ''},
                    {'name': 'Salbei', 'note': 'hemmt Gurkenwachstum'},
                ],
            },
            {'name': 'Dill'},
        ]

        response = self.client.post(APPLY_URL, {'items': rows}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['companions']['created'], 4)
        self.assertEqual(response.data['companions']['unresolved'], ['Salbei'])
        cucumber = Crop.objects.get(project=self.project, name='Gurke')
        dill = Crop.objects.get(project=self.project, name='Dill')
        relations = CropCompanion.objects.filter(project=self.project)
        self.assertTrue(relations.filter(kind='good', reason='pest_control').filter(
            crop__in=[cucumber, dill], companion_crop__in=[cucumber, dill],
        ).exists())
        self.assertTrue(relations.filter(kind='bad', companion_family_id='Brassicaceae', crop=cucumber).exists())
        self.assertTrue(relations.filter(kind='bad', companion_text='Salbei', note='hemmt Gurkenwachstum').exists())

    def test_a_pair_listed_with_the_other_kind_keeps_the_existing_one(self):
        self.relate(self.tomato, self.potato, kind=CropCompanion.KIND_GOOD)

        response = self.client.post(APPLY_URL, {
            'items': [{'name': 'Tomate', 'bad_companions': [{'name': 'Kartoffel', 'note': 'Krankheiten'}]}],
            'confirm_updates': True,
        }, format='json')

        self.assertEqual(response.data['companions']['created'], 0)
        self.assertEqual(response.data['companions']['conflicts'][0]['kept'], 'good')
        self.assertEqual(CropCompanion.objects.get().kind, 'good')

    def test_a_names_only_reimport_keeps_reason_and_note(self) -> None:
        # The spreadsheet holds names only (docs/crop-companions.md), so a
        # re-imported export must not clear what the crop form stored.
        relation = self.relate(self.tomato, self.potato)
        CropCompanion.objects.filter(pk=relation.pk).update(reason='shared_pests_diseases', note='Krautfäule')
        CropCompanion.objects.create(
            project=self.project, crop=self.tomato, companion_text='Salbei', kind=CropCompanion.KIND_GOOD,
            reason='pest_control', note='Duft',
        )

        response = self.client.post(APPLY_URL, {
            'items': [{
                'name': 'Tomate',
                'good_companions': [{'name': 'Salbei', 'reason': 'other', 'note': ''}],
                'bad_companions': [{'name': 'Kartoffel', 'reason': 'other', 'note': ''}],
            }],
            'confirm_updates': True,
        }, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['companions']['created'], 0)
        self.assertCountEqual(
            CropCompanion.objects.values_list('kind', 'reason', 'note'),
            [('bad', 'shared_pests_diseases', 'Krautfäule'), ('good', 'pest_control', 'Duft')],
        )

    def test_a_variety_row_gets_its_neighbours_on_the_kultur(self):
        response = self.client.post(APPLY_URL, {
            'items': [{'name': 'Paprika', 'variety': 'Frühzauber', 'bad_companions': [{'name': 'Kartoffel'}]}],
        }, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        relation = CropCompanion.objects.get()
        kulturen = {relation.crop.variety, relation.companion_crop.variety}
        self.assertEqual(kulturen, {''})

    def test_preview_counts_names_of_the_same_file_as_known(self):
        response = self.client.post(PREVIEW_URL, [
            {'name': 'Gurke', 'bad_companions': [{'name': 'Melone'}, {'name': 'Unbekanntes Kraut'}]},
            {'name': 'Melone'},
        ], format='json')

        self.assertEqual(response.status_code, 200)
        companions = response.data['results'][0]['companions']
        self.assertEqual(companions, {'count': 2, 'unresolved': ['Unbekanntes Kraut']})
        self.assertEqual(CropCompanion.objects.count(), 0)


class CompanionLibraryTestCase(CropCompanionTestCase):
    def setUp(self):
        super().setUp()
        grant_established_trust(self.user)
        self.tomato_species = CropSpecies.objects.create(name='Companion test tomato')
        self.potato_species = CropSpecies.objects.create(name='Companion test potato')
        for crop, species in ((self.tomato, self.tomato_species), (self.potato, self.potato_species)):
            crop.crop_species = species
            crop.growth_duration_days = 90
            crop.harvest_duration_days = 30
            crop.save()

    def publish(self, crop: Crop):
        return self.client.post(f'/openfarmplanner/api/crops/{crop.id}/publish-public/', {
            'accepted_public_library_terms': True,
            'crop_species_id': crop.crop_species_id,
            'original_language_code': 'de',
            'publish_as_general': True,
        }, format='json')


class CompanionLibraryTests(CompanionLibraryTestCase):
    """Publishing shares neighbours by crop species or family; importing maps them back."""

    def test_publishing_shares_species_and_family_neighbours_and_counts_the_rest(self):
        self.relate(self.tomato, self.potato)
        CropCompanion.objects.create(
            project=self.project, crop=self.tomato, companion_family_id='Brassicaceae', kind='good',
        )
        CropCompanion.objects.create(project=self.project, crop=self.tomato, companion_text='Salbei', kind='bad')

        preview = self.client.get(
            f'/openfarmplanner/api/crops/{self.tomato.id}/publish-public/preview/',
            {'crop_species_id': self.tomato_species.id, 'original_language_code': 'de', 'publish_as_general': 'true'},
        )
        response = self.publish(self.tomato)

        self.assertEqual(preview.data['unpublishable_companion_count'], 1)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(PublicCrop.objects.get(variety='').companions, [
            {'species': self.potato_species.id, 'species_name': 'Kartoffel', 'family': None,
             'kind': 'bad', 'reason': 'other', 'note': ''},
            {'species': None, 'species_name': '', 'family': 'Brassicaceae',
             'kind': 'good', 'reason': 'other', 'note': ''},
        ])

    def test_importing_maps_species_to_the_projects_kultur_and_keeps_others_as_text(self):
        sage_species = CropSpecies.objects.create(name='Companion test sage')
        entry = PublicCrop.objects.create(
            name='Paprika', variety='', status=PublicCrop.STATUS_PUBLISHED, created_by=self.user,
            crop_species=CropSpecies.objects.create(name='Companion test pepper'),
            growth_duration_days=90, harvest_duration_days=30,
            companions=[
                {'species': self.potato_species.id, 'species_name': 'Kartoffel', 'family': None,
                 'kind': 'bad', 'reason': 'shared_pests_diseases', 'note': 'Krautfäule'},
                {'species': sage_species.id, 'species_name': 'Salbei', 'family': None,
                 'kind': 'good', 'reason': 'other', 'note': ''},
                {'species': None, 'species_name': '', 'family': 'Brassicaceae',
                 'kind': 'good', 'reason': 'other', 'note': ''},
            ],
        )

        response = self.client.post(f'/openfarmplanner/api/public-crops/{entry.id}/import/', {}, format='json')

        self.assertEqual(response.status_code, 201, response.data)
        imported = Crop.objects.get(id=response.data['crop']['id'])
        relations = CropCompanion.objects.filter(project=self.project)
        self.assertTrue(relations.filter(kind='bad', reason='shared_pests_diseases', note='Krautfäule').filter(
            crop__in=[imported, self.potato], companion_crop__in=[imported, self.potato],
        ).exists())
        self.assertTrue(relations.filter(crop=imported, companion_text='Salbei', kind='good').exists())
        self.assertTrue(relations.filter(crop=imported, companion_family_id='Brassicaceae').exists())

    def test_a_direct_edit_rejects_a_neighbour_naming_both_species_and_family(self):
        self.publish(self.tomato)
        entry = PublicCrop.objects.get(variety='')

        response = self.client.patch(f'/openfarmplanner/api/public-crops/{entry.id}/', {
            'companions': [{'species': self.potato_species.id, 'family': 'Brassicaceae', 'kind': 'bad'}],
        }, format='json')

        self.assertEqual(response.status_code, 400)


class CompanionReplaceApiTests(CropCompanionTestCase):
    """The crop form saves a Kultur's whole list through ``replace``."""

    url = f'{COMPANIONS_URL}replace/'

    def test_creates_updates_and_deletes_to_match_the_list(self):
        kept = self.relate(self.tomato, self.potato)
        dropped = CropCompanion.objects.create(
            project=self.project, crop=self.tomato, companion_text='Salbei', kind='bad',
        )

        response = self.client.put(self.url, {'crop': self.tomato.id, 'relations': [
            {'companion_crop': self.potato.id, 'kind': 'bad', 'reason': 'shared_pests_diseases', 'note': 'Fäule'},
            {'companion_family': 'Brassicaceae', 'kind': 'good'},
        ]}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 2)
        kept.refresh_from_db()
        self.assertEqual((kept.reason, kept.note), ('shared_pests_diseases', 'Fäule'))
        self.assertFalse(CropCompanion.objects.filter(pk=dropped.pk).exists())
        self.assertTrue(CropCompanion.objects.filter(crop=self.tomato, companion_family_id='Brassicaceae').exists())

    def test_a_pair_saved_from_the_other_side_stays_one_relation(self):
        pair = self.relate(self.tomato, self.potato)

        response = self.client.put(self.url, {'crop': self.potato.id, 'relations': [
            {'companion_crop': self.tomato.id, 'kind': 'good'},
        ]}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(CropCompanion.objects.filter(project=self.project).count(), 1)
        pair.refresh_from_db()
        self.assertEqual(pair.kind, 'good')

    def test_a_neighbour_listed_twice_is_rejected_at_its_position(self):
        response = self.client.put(self.url, {'crop': self.tomato.id, 'relations': [
            {'companion_text': 'Salbei', 'kind': 'good'},
            {'companion_text': ' salbei ', 'kind': 'bad'},
        ]}, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('companion', response.data['relations'][1])
        self.assertFalse(CropCompanion.objects.exists())

    def test_an_invalid_item_saves_nothing(self):
        self.relate(self.tomato, self.potato)

        response = self.client.put(self.url, {'crop': self.tomato.id, 'relations': [
            {'companion_family': 'Brassicaceae', 'kind': 'good'},
            {'companion_crop': self.tomato.id, 'kind': 'bad'},
        ]}, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn(1, response.data['relations'])
        self.assertEqual(CropCompanion.objects.filter(project=self.project).count(), 1)

    def test_a_variety_cannot_be_saved_to(self):
        roma = Crop.objects.create(name='Tomate', variety='Roma', project=self.project)

        response = self.client.put(self.url, {'crop': roma.id, 'relations': []}, format='json')

        self.assertEqual(response.status_code, 400)

    def test_an_unchanged_list_records_no_history(self):
        self.relate(self.tomato, self.potato)
        revisions = EntityRevision.objects.count()

        response = self.client.put(self.url, {'crop': self.tomato.id, 'relations': [
            {'companion_crop': self.potato.id, 'kind': 'bad', 'reason': 'other', 'note': ''},
        ]}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(EntityRevision.objects.count(), revisions)


class CompanionLibrarySyncTests(CompanionLibraryTestCase):
    """Neighbours take part in the library sync and update like a copy field."""

    def setUp(self):
        super().setUp()
        self.fennel_species = CropSpecies.objects.create(name='Companion test fennel')
        self.relate(self.tomato, self.potato)
        self.assertEqual(self.publish(self.tomato).status_code, 201)
        self.entry = PublicCrop.objects.get(variety='', crop_species=self.tomato_species)
        self.tomato.refresh_from_db()

    def entry_changes(self, companions):
        self.entry.companions = companions
        self.entry.version += 1
        self.entry.save()

    def preview_fields(self):
        response = self.client.get(
            f'/openfarmplanner/api/crops/{self.tomato.id}/public-sync/', {'public_crop_id': self.entry.id},
        )
        self.assertEqual(response.status_code, 200, response.data)
        return {change['field']: change for change in response.data['changes']}

    def sync(self, **fields):
        return self.client.post(f'/openfarmplanner/api/crops/{self.tomato.id}/public-sync/', {
            'public_crop_id': self.entry.id, 'base_version': self.entry.version,
            'pull_fields': [], 'push_fields': [], 'pin_fields': [], **fields,
        }, format='json')

    CABBAGES = [
        {'species': None, 'species_name': '', 'family': 'Brassicaceae', 'kind': 'good', 'reason': 'other', 'note': ''},
    ]

    def fennel(self):
        return {'species': self.fennel_species.id, 'species_name': 'Fenchel', 'family': None,
                'kind': 'bad', 'reason': 'allelopathy', 'note': ''}

    def test_publishing_links_the_kultur_with_nothing_left_to_sync(self):
        self.assertTrue(self.tomato.source_public_crop_id)
        self.assertNotIn('companions', self.preview_fields())

    def test_taking_the_library_value_replaces_the_shareable_neighbours(self):
        CropCompanion.objects.create(project=self.project, crop=self.tomato, companion_text='Salbei', kind='bad')
        self.entry_changes([self.fennel(), *self.CABBAGES])

        change = self.preview_fields()['companions']
        response = self.sync(pull_fields=['companions'])

        self.assertEqual([item['kind'] for item in change['public_value']], ['bad', 'good'])
        self.assertEqual([item['kind'] for item in change['local_value']], ['bad'])
        self.assertEqual(response.status_code, 200, response.data)
        relations = CropCompanion.objects.filter(project=self.project)
        # The pair is gone from both Kulturen, free text stays, the species the
        # project has no Kultur for becomes free text with the stored name.
        self.assertFalse(relations.filter(companion_crop__isnull=False).exists())
        self.assertTrue(relations.filter(crop=self.tomato, companion_text='Salbei').exists())
        self.assertTrue(relations.filter(crop=self.tomato, companion_text='Fenchel', reason='allelopathy').exists())
        self.assertTrue(relations.filter(crop=self.tomato, companion_family_id='Brassicaceae').exists())
        self.assertNotIn('companions', self.preview_fields())

    def test_sharing_mine_writes_the_kulturs_list_into_the_entry(self):
        response = self.client.post(COMPANIONS_URL, {
            'crop': self.tomato.id, 'companion_family': 'Brassicaceae', 'kind': 'good',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.tomato.refresh_from_db()
        self.assertTrue(self.tomato.is_modified_from_source)

        self.assertTrue(self.preview_fields()['companions']['pushable'])
        response = self.sync(push_fields=['companions'])

        self.assertEqual(response.status_code, 200, response.data)
        self.entry.refresh_from_db()
        self.assertEqual([item['family'] or item['species'] for item in self.entry.companions],
                         [self.potato_species.id, 'Brassicaceae'])

    def test_a_pinned_list_is_kept_by_a_library_update(self):
        CropCompanion.objects.create(
            project=self.project, crop=self.tomato, companion_family_id='Brassicaceae', kind='good',
        )
        self.assertEqual(self.sync(pin_fields=['companions']).status_code, 200)
        self.entry_changes([self.fennel()])

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{self.entry.id}/import/', {'mode': 'update'}, format='json',
        )

        self.assertIn(response.status_code, (200, 201), response.data)
        self.assertTrue(CropCompanion.objects.filter(crop=self.tomato, companion_family_id='Brassicaceae').exists())
        self.assertFalse(CropCompanion.objects.filter(companion_text='Fenchel').exists())

    def test_a_library_update_lists_and_applies_the_neighbours(self):
        self.entry_changes([self.fennel()])

        status_response = self.client.get(f'/openfarmplanner/api/crops/{self.tomato.id}/public-update/')
        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{self.entry.id}/import/', {'mode': 'update'}, format='json',
        )

        self.assertEqual(status_response.status_code, 200, status_response.data)
        self.assertIn('companions', [change['field'] for change in status_response.data['changes']])
        self.assertIn(response.status_code, (200, 201), response.data)
        relations = CropCompanion.objects.filter(project=self.project)
        self.assertEqual(list(relations.values_list('companion_text', flat=True)), ['Fenchel'])


class FreeTextLinkingTests(CropCompanionTestCase):
    """A free-text neighbour becomes a link once a Kultur with its name exists."""

    def text(self, owner: Crop, text: str, kind: str = CropCompanion.KIND_GOOD) -> CropCompanion:
        return CropCompanion.objects.create(project=self.project, crop=owner, companion_text=text, kind=kind)

    def test_creating_a_kultur_links_free_text_with_its_name(self):
        entry = self.text(self.tomato, 'salbei ', kind='good')

        response = self.client.post('/openfarmplanner/api/crops/', {'name': 'Salbei'}, format='json')

        self.assertEqual(response.status_code, 201, response.data)
        sage = Crop.objects.get(project=self.project, name='Salbei')
        entry.refresh_from_db()
        self.assertEqual((entry.companion_text, entry.kind), ('', 'good'))
        self.assertEqual({entry.crop_id, entry.companion_crop_id}, {self.tomato.id, sage.id})
        self.assertLess(entry.crop_id, entry.companion_crop_id)

    def test_renaming_a_kultur_links_free_text_with_the_new_name(self):
        entry = self.text(self.tomato, 'Erdäpfel')

        response = self.client.patch(f'/openfarmplanner/api/crops/{self.potato.id}/', {'name': 'Erdäpfel'}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        entry.refresh_from_db()
        self.assertEqual(entry.companion_crop_id, max(self.tomato.id, self.potato.id))

    def test_a_pair_that_already_exists_drops_the_free_text_entry(self):
        self.relate(self.tomato, self.cabbage, kind='bad')
        duplicate = self.text(self.cabbage, 'Tomate neu')

        self.client.patch(f'/openfarmplanner/api/crops/{self.tomato.id}/', {'name': 'Tomate neu'}, format='json')

        self.assertFalse(CropCompanion.objects.filter(pk=duplicate.pk).exists())
        self.assertEqual(CropCompanion.objects.filter(project=self.project).count(), 1)

    def test_a_variety_does_not_take_over_free_text(self):
        entry = self.text(self.tomato, 'Kartoffel Linda')

        Crop.objects.create(project=self.project, name='Kartoffel', variety='Linda')
        self.client.post('/openfarmplanner/api/crops/', {'name': 'Kartoffel', 'variety': 'Annabelle'}, format='json')

        entry.refresh_from_db()
        self.assertEqual(entry.companion_text, 'Kartoffel Linda')

    def test_the_import_links_once_for_the_whole_file(self):
        entry = self.text(self.tomato, 'Ringelblume')

        response = self.client.post(
            APPLY_URL, {'items': [{'name': 'Ringelblume'}, {'name': 'Borretsch'}]}, format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        entry.refresh_from_db()
        self.assertEqual(entry.companion_crop_id, Crop.objects.get(project=self.project, name='Ringelblume').id)


class LocalizedCompanionNotesTests(CompanionLibraryTestCase):
    def test_project_note_edits_preserve_other_languages_and_reciprocal_identity(self) -> None:
        relation = self.relate(self.tomato, self.potato)
        relation.note = 'Quelle DE'
        relation.save(update_fields=['note'])
        url = f'{COMPANIONS_URL}{relation.pk}/'
        for language, note in [('en', 'Source EN\n2025'), ('fr', 'Source FR')]:
            response = self.client.patch(url, {'note_language_code': language, 'note': note}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
        relation.refresh_from_db()
        self.assertEqual(relation.notes, {'de': 'Quelle DE', 'en': 'Source EN\n2025', 'fr': 'Source FR'})
        for language, expected in [('de', 'Quelle DE'), ('en', 'Source EN\n2025'), ('es', '')]:
            response = self.client.get(url, HTTP_ACCEPT_LANGUAGE=language)
            self.assertEqual(response.data['note'], expected)
        self.assertEqual(CropCompanion.objects.filter(project=self.project).count(), 1)

    def test_public_note_edits_and_missing_language_have_no_fallback(self) -> None:
        self.publish(self.tomato)
        entry = PublicCrop.objects.get(variety='')
        url = f'/openfarmplanner/api/public-crops/{entry.pk}/'
        base = {'species': self.potato_species.pk, 'kind': 'bad', 'reason': 'shared_pests_diseases'}
        for language, note in [('de', 'Quelle DE'), ('fr', 'Source FR')]:
            response = self.client.patch(url, {'companions': [{**base, 'note': note, 'note_language_code': language}]}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
        entry.refresh_from_db()
        self.assertEqual(entry.companions[0]['notes'], {'de': 'Quelle DE', 'fr': 'Source FR'})
        response = self.client.get(url, HTTP_ACCEPT_LANGUAGE='es')
        self.assertEqual(response.data['companions'][0]['note'], '')
        self.assertEqual(response.data['companions'][0]['reason'], 'shared_pests_diseases')
        response = self.client.patch(url, {'companions': [{**base, 'note_language_code': 'fr', 'note': ''}]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        entry.refresh_from_db()
        self.assertEqual(entry.companions[0]['notes'], {'de': 'Quelle DE', 'fr': ''})

    def test_invalid_language_maps_are_rejected(self) -> None:
        relation = self.relate(self.tomato, self.potato)
        for value in ([], {'xx': 'Unknown'}, {'de': 12}, {'en': 'x' * 501}):
            response = self.client.patch(f'{COMPANIONS_URL}{relation.pk}/', {'notes': value}, format='json')
            self.assertEqual(response.status_code, 400, response.data)

    def test_import_note_validation_does_not_expose_nested_exception_details(self) -> None:
        from unittest.mock import patch

        from rest_framework.exceptions import ValidationError

        row = {'name': 'Gurke', 'good_companions': [{'name': 'Tomate', 'notes': {'fr': 'Source'}}]}
        diagnostic = 'Internal note parser diagnostic'
        with patch('farm.services.crop_companions.validate_notes', side_effect=ValidationError(diagnostic)):
            preview = self.client.post(PREVIEW_URL, [row], format='json')
            applied = self.client.post(APPLY_URL, {'items': [row]}, format='json')
        self.assertEqual(preview.data['results'][0]['error_code'], 'companion_notes_invalid')
        self.assertEqual(applied.data['errors'][0]['error_code'], 'companion_notes_invalid')
        self.assertNotIn(diagnostic, str(preview.data))
        self.assertNotIn(diagnostic, str(applied.data))
        self.assertFalse(Crop.objects.filter(project=self.project, name='Gurke').exists())

    def test_import_note_merge_and_explicit_empty_replacement(self) -> None:
        relation = self.relate(self.tomato, self.potato)
        relation.notes = {'de': 'Quelle', 'fr': 'Ancienne source'}
        relation.reason = 'shared_pests_diseases'
        relation.save()
        item = {'name': self.tomato.name, 'bad_companions': [{'name': self.potato.name, 'note': 'Nouvelle source'}]}
        for note, replacement, expected in [('Nouvelle source', False, 'Nouvelle source'), ('', False, 'Nouvelle source'), ('', True, '')]:
            item['bad_companions'][0]['note'] = note
            response = self.client.post(APPLY_URL, {'items': [item], 'confirm_updates': True, 'companion_note_language': 'fr', 'replace_companion_notes': replacement}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
            relation.refresh_from_db()
            self.assertEqual(relation.notes, {'de': 'Quelle', 'fr': expected})
            self.assertEqual(relation.reason, 'shared_pests_diseases')

    def test_legacy_group_resolution_is_exact_and_ambiguous_input_stays_text(self) -> None:
        row = {'name': 'Gurke', 'good_companions': [{'name': 'Tomate, Kartoffel – Quelle 2025', 'legacy': True}]}
        response = self.client.post(PREVIEW_URL, [row], format='json')
        self.assertEqual(response.data['results'][0]['companions']['count'], 2)
        response = self.client.post(APPLY_URL, {'items': [row], 'companion_note_language': 'fr'}, format='json')
        self.assertEqual(response.data['companions']['created'], 2)
        self.assertEqual(list(CropCompanion.objects.values_list('notes', flat=True)), [{'fr': 'Quelle 2025'}] * 2)
        Crop.objects.create(project=self.project, name='Tomate - Foo')
        ambiguous = {'name': 'Zucchini', 'good_companions': [{'name': 'Tomate - Foo - Bar', 'legacy': True}]}
        preview = self.client.post(PREVIEW_URL, [ambiguous], format='json').data['results'][0]
        self.assertEqual(preview['companions']['warnings'], ['Tomate - Foo - Bar'])
        response = self.client.post(APPLY_URL, {'items': [ambiguous]}, format='json')
        self.assertTrue(CropCompanion.objects.filter(companion_text='Tomate - Foo - Bar').exists())

    def test_known_spaced_dash_name_wins_over_legacy_suffix(self) -> None:
        named = Crop.objects.create(project=self.project, name='Salat - Pflücksalat')
        Crop.objects.create(project=self.project, name='Salat')
        response = self.client.post(APPLY_URL, {'items': [{'name': 'Gurke', 'good_companions': [{'name': named.name, 'legacy': True}]}]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        relation = CropCompanion.objects.get()
        self.assertIn(named.pk, (relation.crop_id, relation.companion_crop_id))
        self.assertEqual(relation.notes, {})

    def test_json_language_maps_are_authoritative_and_do_not_copy_derived_note(self) -> None:
        response = self.client.post(APPLY_URL, {'items': [{'name': 'Gurke', 'good_companions': [{'name': 'Tomate', 'notes': {'fr': 'Source FR'}, 'note': 'Source FR'}]}], 'companion_note_language': 'de'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(CropCompanion.objects.get().notes, {'fr': 'Source FR'})

    def test_private_and_public_maps_ignore_derived_text_without_an_explicit_language(self) -> None:
        relation = self.relate(self.tomato, self.potato)
        private_url = f'{COMPANIONS_URL}{relation.pk}/'
        self.publish(self.tomato)
        entry = PublicCrop.objects.get(variety='')
        public_url = f'/openfarmplanner/api/public-crops/{entry.pk}/'
        identity = {'species': self.potato_species.pk, 'kind': relation.kind, 'reason': relation.reason}
        for explicit in (False, True):
            patch = {'notes': {'fr': 'Source FR'}, 'note': 'Selected English source'}
            if explicit:
                patch['note_language_code'] = 'en'
            private = self.client.patch(private_url, patch, format='json', HTTP_ACCEPT_LANGUAGE='en')
            public = self.client.patch(public_url, {'companions': [{**identity, **patch}]}, format='json', HTTP_ACCEPT_LANGUAGE='en')
            self.assertEqual(private.status_code, 200, private.data)
            self.assertEqual(public.status_code, 200, public.data)
            expected = {'fr': 'Source FR', **({'en': 'Selected English source'} if explicit else {})}
            self.assertEqual(private.data['notes'], expected)
            self.assertEqual(public.data['companions'][0]['notes'], expected)

    def test_public_edit_merges_against_the_locked_current_language_map(self) -> None:
        from farm.crops.serializers.public import PublicCropUpdateSerializer
        from farm.services.public_crops import update_public_crop_directly

        self.publish(self.tomato)
        entry = PublicCrop.objects.get(variety='')
        base = {'species': self.potato_species.pk, 'family': None, 'kind': 'bad', 'reason': 'other'}
        entry.companions = [{**base, 'notes': {'de': 'Quelle', 'fr': 'Ancienne source'}}]
        entry.save()
        english = PublicCropUpdateSerializer(entry, data={'companions': [{**base, 'note': 'New source', 'note_language_code': 'en'}]}, partial=True)
        self.assertTrue(english.is_valid(), english.errors)
        update_public_crop_directly(public_crop=entry, user=self.user, data={'companions': [{**base, 'note': 'Nouvelle source', 'note_language_code': 'fr'}]})
        updated = update_public_crop_directly(public_crop=entry, user=self.user, data=english.validated_data)
        self.assertEqual(updated.companions[0]['notes'], {'de': 'Quelle', 'fr': 'Nouvelle source', 'en': 'New source'})

    def test_publication_scopes_notes_and_preserves_the_remote_other_language(self) -> None:
        from farm.services.public_crops import (
            build_public_crop_payload,
            update_public_crop_directly,
        )

        relation = self.relate(self.tomato, self.potato)
        relation.notes = {'de': 'Quelle', 'fr': 'Old private copy'}
        relation.save()
        self.publish(self.tomato)
        entry = PublicCrop.objects.get(variety='')
        entry.companions[0]['notes']['fr'] = 'New public French source'
        entry.save()
        self.tomato.refresh_from_db()
        payload = build_public_crop_payload(self.tomato, companion_note_language='de')
        updated = update_public_crop_directly(public_crop=entry, user=self.user, data={'companions': payload['companions']})
        self.assertEqual(updated.companions[0]['notes']['fr'], 'New public French source')

    def test_private_note_write_merges_after_another_language_changed(self) -> None:
        from farm.crops.serializers.companions import CropCompanionSerializer

        relation = self.relate(self.tomato, self.potato)
        relation.notes = {'de': 'Quelle', 'fr': 'Ancienne source'}
        relation.save()
        english = CropCompanionSerializer(relation, data={'note': 'Source', 'note_language_code': 'en'}, partial=True, context={'project': self.project})
        self.assertTrue(english.is_valid(), english.errors)
        CropCompanion.objects.filter(pk=relation.pk).update(notes={'de': 'Quelle', 'fr': 'Nouvelle source'})
        saved = english.save()
        self.assertEqual(saved.notes, {'de': 'Quelle', 'fr': 'Nouvelle source', 'en': 'Source'})

    def test_library_pull_preserves_private_languages_absent_from_the_entry(self) -> None:
        from farm.services.crop_companions import replace_library_companions

        relation = self.relate(self.tomato, self.potato)
        relation.notes = {'de': 'Quelle', 'fr': 'Source privée'}
        relation.save()
        replace_library_companions(self.tomato, [{'species': self.potato_species.pk, 'species_name': 'Kartoffel', 'kind': 'bad', 'reason': 'other', 'notes': {'de': 'Neue Quelle'}}])
        relation.refresh_from_db()
        self.assertEqual(relation.notes, {'de': 'Neue Quelle', 'fr': 'Source privée'})

    def test_additive_library_import_adds_missing_languages_and_keeps_local_notes(self) -> None:
        from farm.services.crop_companions import apply_library_companions

        relation = self.relate(self.tomato, self.potato)
        relation.notes = {'de': 'Private source'}
        relation.save()
        added = apply_library_companions(self.tomato, [{
            'species': self.potato_species.pk, 'species_name': 'Kartoffel',
            'kind': relation.kind, 'reason': 'other',
            'notes': {'de': 'Public source', 'fr': 'Source française'},
        }])
        relation.refresh_from_db()
        self.assertEqual(added, 0)
        self.assertEqual(relation.notes, {'de': 'Private source', 'fr': 'Source française'})

    def test_restoring_an_old_private_snapshot_resets_newer_note_versions(self) -> None:
        from farm.history.records import _serialize_instance
        from farm.history.restore import _restore_project_state_at

        relation = self.relate(self.tomato, self.potato)
        relation.note = 'Legacy source'
        relation.save()
        snapshot = _serialize_instance(relation)
        snapshot.pop('notes')
        revision = EntityRevision.objects.create(project=self.project, entity_type='crop_companion', object_id=relation.pk, action='created', snapshot=snapshot)
        relation.notes = {'fr': 'Newer source'}
        relation.save()
        _restore_project_state_at(self.project, revision.created_at)
        relation.refresh_from_db()
        self.assertEqual(relation.notes, {'de': 'Legacy source'})

    def test_known_legacy_reason_labels_remain_structured(self) -> None:
        from farm.services.crop_companions import LEGACY_REASON_LABELS

        label = LEGACY_REASON_LABELS['pest_control'][0]
        row = {'name': 'Gurke', 'good_companions': [{'name': f'Tomate – {label}: Source 2025', 'legacy': True}]}
        response = self.client.post(APPLY_URL, {'items': [row], 'companion_note_language': 'en'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        relation = CropCompanion.objects.get()
        self.assertEqual(relation.reason, 'pest_control')
        self.assertEqual(relation.notes, {'en': 'Source 2025'})

    def test_old_public_revision_recovers_its_original_note_language(self) -> None:
        from farm.models import PublicCropRevision
        from farm.services.public_crops import build_public_crop_snapshot, restore_public_crop_version

        self.publish(self.tomato)
        entry = PublicCrop.objects.get(variety='')
        entry.original_language_code = 'fr'
        legacy = {'family': 'Brassicaceae', 'species': None, 'species_name': '', 'kind': 'bad', 'reason': 'other', 'note': 'Ancienne source'}
        snapshot = build_public_crop_snapshot(entry)
        snapshot['companions'] = [legacy]
        revision = PublicCropRevision.objects.get(public_crop=entry, version=1)
        revision.snapshot = snapshot
        revision.save(update_fields=['snapshot'])
        entry.companions = [{**legacy, 'notes': {'fr': 'Nouvelle source', 'en': 'New source'}}]
        entry.version = 2
        entry.save()
        restored = restore_public_crop_version(public_crop=entry, version=revision.version, user=self.user)
        self.assertEqual(restored.companions[0]['notes'], {'fr': 'Ancienne source'})

    def test_invalid_import_notes_are_previewed_without_truncation_or_partial_writes(self) -> None:
        for item in [
            {'name': 'Tomate', 'note': 'x' * 501},
            {'name': 'Tomate – ' + 'x' * 501, 'legacy': True},
            {'name': 'Tomate', 'notes': {'xx': 'Unsupported'}},
            {'name': 'x' * 201, 'legacy': 'yes'},
        ]:
            row = {'name': 'Invalid note crop', 'good_companions': [item]}
            preview = self.client.post(PREVIEW_URL, [row], format='json')
            result = preview.data['results'][0]
            self.assertEqual(result['error_code'], 'companion_notes_invalid', result)
            self.assertEqual(result['import_data']['good_companions'][0], item)
            applied = self.client.post(APPLY_URL, {'items': [row]}, format='json')
            self.assertEqual(applied.data['errors'][0]['error_code'], 'companion_notes_invalid', applied.data)
            self.assertFalse(Crop.objects.filter(project=self.project, name=row['name']).exists())
