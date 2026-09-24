"""Shared base test case for the farm API domain test modules."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase as DRFAPITestCase

from farm.models import (
    Bed,
    Crop,
    EntityRevision,
    Field,
    Location,
    Project,
    ProjectMembership,
    Supplier,
)

User = get_user_model()


def record_later_revision(project: Project) -> EntityRevision:
    """Record a neutral, non-restorable revision so an earlier restore point
    is no longer the current version (restoring the current one is refused)."""
    return EntityRevision.objects.create(
        project=project,
        entity_type='project',
        object_id=project.id,
        action=EntityRevision.ACTION_UPDATED,
        snapshot={},
    )


class ProjectApiTestCase(DRFAPITestCase):
    """Authenticated project with one location/field/bed/crop/supplier."""

    def setUp(self):
        self.user = User.objects.create_user(username='testuser', email='test@example.com', password='testpass', is_active=True)
        self.project = Project.objects.create(name='Test Project', slug='test-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        self.location = Location.objects.create(name="API Test Location", project=self.project)
        self.field = Field.objects.create(name="API Test Field", location=self.location, project=self.project)
        self.bed = Bed.objects.create(
            name="API Test Bed",
            field=self.field,
            area_sqm=20.0,  # Total area: 20 sqm
            project=self.project,
        )
        self.crop = Crop.objects.create(
            name="API Test Crop",
            growth_duration_days=7,
            harvest_duration_days=2,
            project=self.project,
        )
        self.supplier = Supplier.objects.create(name="Test Supplier Co.", homepage_url='https://test-supplier-co..example', project=self.project)
