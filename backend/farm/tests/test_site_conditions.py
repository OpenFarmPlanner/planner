"""Inherited growing-area site conditions (#1075)."""

import json
from pathlib import Path
from types import SimpleNamespace

from django.test import SimpleTestCase

from farm.models import Bed, Field, Location
from farm.services.field_duplication import duplicate_field
from farm.services.site_conditions import (
    INHERITED_SITE_CONDITION_FIELDS,
    resolve_effective_conditions,
)
from farm.tests.api_base import ProjectApiTestCase

FIXTURE_PATH = Path(__file__).resolve().parents[3] / 'tests' / 'fixtures' / 'site_conditions.json'
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding='utf-8'))
API = '/openfarmplanner/api'


class ResolveEffectiveConditionsTest(SimpleTestCase):
    def test_shared_fixture_cases(self) -> None:
        for case in FIXTURE['cases']:
            with self.subTest(case['name']):
                chain = [
                    (
                        node['level'],
                        SimpleNamespace(id=node['id'], name=node['name'], **{
                            name: node['values'].get(name)
                            for name in INHERITED_SITE_CONDITION_FIELDS
                        }),
                    )
                    for node in case['chain']
                ]
                resolved = resolve_effective_conditions(chain)
                self.assertEqual(
                    {name: condition.as_dict() for name, condition in resolved.items()},
                    case['expected'],
                )


class SiteConditionsApiTest(ProjectApiTestCase):
    def test_legacy_rows_have_no_conditions(self) -> None:
        response = self.client.get(f'{API}/beds/{self.bed.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data['light_condition'])
        self.assertEqual(response.data['soil_description'], '')
        for name in INHERITED_SITE_CONDITION_FIELDS:
            self.assertIsNone(response.data['effective_site_conditions'][name]['value'])

    def test_bed_inherits_from_location_and_reset_restores_inheritance(self) -> None:
        response = self.client.patch(
            f'{API}/locations/{self.location.id}/',
            {'light_condition': 'sunny', 'irrigation': 'unavailable'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        response = self.client.patch(
            f'{API}/beds/{self.bed.id}/', {'light_condition': 'shade'}, format='json',
        )
        effective = response.data['effective_site_conditions']
        self.assertEqual(effective['light_condition']['source'], 'bed')
        self.assertEqual(effective['irrigation'], {
            'value': 'unavailable', 'source': 'location',
            'source_id': self.location.id, 'source_name': self.location.name,
        })

        response = self.client.patch(
            f'{API}/beds/{self.bed.id}/', {'light_condition': None}, format='json',
        )
        light = response.data['effective_site_conditions']['light_condition']
        self.assertEqual((light['value'], light['source']), ('sunny', 'location'))

    def test_changing_a_parent_keeps_child_overrides(self) -> None:
        self.field.soil_moisture = 'dry'
        self.field.save()
        response = self.client.patch(
            f'{API}/locations/{self.location.id}/', {'soil_moisture': 'moist'}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.field.refresh_from_db()
        self.assertEqual(self.field.soil_moisture, 'dry')

    def test_put_without_condition_fields_keeps_them(self) -> None:
        self.bed.light_condition = 'partial_shade'
        self.bed.soil_description = 'Stony'
        self.bed.save()
        response = self.client.put(
            f'{API}/beds/{self.bed.id}/',
            {'name': 'Renamed', 'field': self.field.id, 'project': self.project.id}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.bed.refresh_from_db()
        self.assertEqual(self.bed.light_condition, 'partial_shade')
        self.assertEqual(self.bed.soil_description, 'Stony')

    def test_invalid_choice_is_rejected(self) -> None:
        response = self.client.patch(
            f'{API}/fields/{self.field.id}/', {'cultivation_environment': 'moon'}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('cultivation_environment', response.data)

    def test_field_accepts_descriptive_fields_and_environment(self) -> None:
        response = self.client.patch(f'{API}/fields/{self.field.id}/', {
            'cultivation_environment': 'polytunnel',
            'soil_type': 'sand',
            'wind_exposure': 'Hedge on the west side',
            'water_supply': 'Rain barrel',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['effective_site_conditions']['soil_type']['source'], 'field')
        self.assertEqual(response.data['wind_exposure'], 'Hedge on the west side')


class FieldDuplicationSiteConditionsTest(ProjectApiTestCase):
    def test_duplicate_copies_structured_conditions_but_not_texts(self) -> None:
        self.field.light_condition = 'shade'
        self.field.cultivation_environment = 'greenhouse'
        self.field.soil_description = 'Compacted'
        self.field.save()
        self.bed.irrigation = 'available'
        self.bed.water_supply = 'Hose'
        self.bed.save()

        result = duplicate_field(self.field, name='Copy', copy_beds=True)

        self.assertEqual(result.field.light_condition, 'shade')
        self.assertEqual(result.field.cultivation_environment, 'greenhouse')
        self.assertEqual(result.field.soil_description, '')
        self.assertEqual(result.beds[0].irrigation, 'available')
        self.assertEqual(result.beds[0].water_supply, '')
        self.assertTrue(Bed.objects.filter(pk=result.beds[0].pk).exists())
        self.assertEqual(Location.objects.count(), 1)
        self.assertEqual(Field.objects.count(), 2)
