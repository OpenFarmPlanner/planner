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
