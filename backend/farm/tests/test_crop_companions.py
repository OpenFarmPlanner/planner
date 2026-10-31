"""Companion planting: neighbour relations, the planning check and the spreadsheet import."""

from datetime import date

from django.utils import timezone

from farm.models import Bed, Crop, CropCompanion, PlantingPlan, Project
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
