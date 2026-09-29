"""Tests for the published drf-spectacular reference (/api/schema/, /api/docs/)."""

from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from drf_spectacular.generators import SchemaGenerator
from rest_framework.test import APIClient, APITestCase

from farm.models import API_TOKEN_PREFIX, Project, ProjectApiToken, ProjectMembership

User = get_user_model()

# The published surface, pinned on purpose: opting a view into the API-token
# allowlist also publishes it, so a change here must be a deliberate one.
EXPECTED_OPERATIONS = {
    ('/api/agent/context/', 'get'),
    ('/api/agent/openapi.json', 'get'),
    ('/api/beds/', 'get'),
    ('/api/beds/{id}/', 'get'),
    ('/api/crop-imports/{draft_id}/', 'get'),
    ('/api/crop-imports/{draft_id}/apply/', 'post'),
    ('/api/crop-imports/preview/', 'post'),
    ('/api/crop-supplier-data/', 'get'),
    ('/api/crop-supplier-data/{id}/', 'get'),
    ('/api/crops/', 'get'),
    ('/api/crops/', 'post'),
    ('/api/crops/{id}/', 'get'),
    ('/api/crops/{id}/', 'put'),
    ('/api/crops/{id}/', 'patch'),
    ('/api/crops/{id}/', 'delete'),
    ('/api/crops/{id}/delete-preview/', 'get'),
    ('/api/crops/{id}/history/', 'get'),
    ('/api/crops/{id}/publish-public/', 'post'),
    ('/api/crops/{id}/undelete/', 'post'),
    ('/api/crops/duplicate-check/', 'get'),
    ('/api/crops/seed-rate-constraints/', 'get'),
    ('/api/fields/', 'get'),
    ('/api/fields/{id}/', 'get'),
    ('/api/locations/', 'get'),
    ('/api/locations/{id}/', 'get'),
    ('/api/planting-plans/', 'get'),
    ('/api/planting-plans/{id}/', 'get'),
    ('/api/public-crops/{id}/', 'put'),
    ('/api/public-crops/{id}/', 'patch'),
    ('/api/seed-packages/', 'get'),
    ('/api/seed-packages/{id}/', 'get'),
    ('/api/suppliers/', 'get'),
    ('/api/suppliers/{id}/', 'get'),
    ('/api/tasks/', 'get'),
    ('/api/tasks/{id}/', 'get'),
}

HTTP_METHODS = {'get', 'post', 'put', 'patch', 'delete'}


def _header_names(operation: dict) -> set[str]:
    return {
        parameter['name']
        for parameter in operation.get('parameters', [])
        if parameter['in'] == 'header'
    }


class SchemaGenerationTests(APITestCase):
    """The schema must build cleanly — this is the CI gate for warnings."""

    def test_schema_generates_without_warnings_and_validates(self):
        with TemporaryDirectory() as directory:
            output = StringIO()
            call_command(
                'spectacular',
                '--fail-on-warn',
                '--validate',
                '--file',
                str(Path(directory) / 'schema.yaml'),
                stdout=output,
                stderr=output,
            )


class PublishedSurfaceTests(APITestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.schema = SchemaGenerator().get_schema(request=None, public=True)

    def _operations(self) -> set[tuple[str, str]]:
        return {
            (path, method)
            for path, operations in self.schema['paths'].items()
            for method in operations
            if method in HTTP_METHODS
        }

    def test_publishes_exactly_the_token_allowlist(self):
        self.assertEqual(self._operations(), EXPECTED_OPERATIONS)

    def test_legacy_prefix_and_aliases_are_not_published(self):
        for path in self.schema['paths']:
            self.assertFalse(path.startswith('/openfarmplanner/'), path)
            self.assertNotIn('/cultures/', path)
            self.assertNotIn('culture-', path)

    def test_bearer_token_is_the_only_security_scheme(self):
        schemes = self.schema['components']['securitySchemes']

        self.assertEqual(set(schemes), {'ApiToken'})
        self.assertEqual(schemes['ApiToken']['type'], 'http')
        self.assertEqual(schemes['ApiToken']['scheme'], 'bearer')

    def test_project_header_is_documented_on_project_scoped_operations(self):
        paths = self.schema['paths']

        self.assertIn('X-Project-Id', _header_names(paths['/api/crops/']['get']))
        self.assertIn('X-Project-Id', _header_names(paths['/api/crop-imports/preview/']['post']))
        self.assertNotIn('X-Project-Id', _header_names(paths['/api/agent/context/']['get']))

    def test_season_header_is_documented_where_it_is_read(self):
        paths = self.schema['paths']

        self.assertIn('X-Season-Id', _header_names(paths['/api/planting-plans/']['get']))
        self.assertNotIn('X-Season-Id', _header_names(paths['/api/crops/']['get']))

    def test_inherited_crop_fields_are_marked_as_raw_values(self):
        crop = self.schema['components']['schemas']['Crop']['properties']

        self.assertIn('effective_values', crop['row_spacing_cm']['description'])
        self.assertIn('not overridable', crop['crop_family']['description'])
        self.assertNotIn('effective_values', crop['name'].get('description', ''))

    def test_description_embeds_the_api_guide(self):
        description = self.schema['info']['description']

        self.assertIn('## Authentication and token lifecycle', description)
        self.assertFalse(description.startswith('# '))


class PublicDocsAccessTests(APITestCase):
    """The reference is readable anonymously and with a token alike."""

    def setUp(self):
        self.client = APIClient()

    def test_schema_and_ui_are_public(self):
        for url in ('/api/schema/', '/api/schema/?format=json', '/api/docs/', '/api/docs/swagger/'):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200, url)

    def test_schema_is_reachable_when_a_token_is_sent(self):
        user = User.objects.create_user(username='schema', email='schema@example.com', password='x')
        project = Project.objects.create(name='Schema')
        ProjectMembership.objects.create(
            user=user, project=project, role=ProjectMembership.ROLE_ADMIN,
        )
        _, raw_token = ProjectApiToken.create_token(user=user, project=project, name='t')

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {raw_token}')
        self.assertEqual(self.client.get('/api/schema/').status_code, 200)

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {API_TOKEN_PREFIX}not-issued')
        self.assertEqual(self.client.get('/api/schema/').status_code, 200)

    def test_swagger_try_it_out_uses_bearer_only(self):
        body = self.client.get('/api/docs/swagger/').content.decode()

        self.assertIn('request.credentials = "omit"', body)
        self.assertIn('persistAuthorization: false', body)
        self.assertNotIn('X-CSRFToken', body)
        self.assertNotIn('csrfmiddlewaretoken', body)
        self.assertNotIn('localStorage', body)

    def test_api_guide_file_exists(self):
        self.assertTrue(Path(settings.API_GUIDE_PATH).is_file())
