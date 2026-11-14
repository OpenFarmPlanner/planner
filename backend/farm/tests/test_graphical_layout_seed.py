from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings

from farm.models import Bed, Field, FieldLayout, Project


@override_settings(DJANGO_ENV='development')
class GraphicalLayoutSeedTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='graphical-fixture-owner')
        self.options = dict(username=self.user.username,
                            database_name=str(connection.settings_dict['NAME']), stdout=StringIO())
        self.environment = patch.dict('os.environ', {'OFP_LOCAL_TEST_DATA': '1'})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def seed(self, **options):
        call_command('seed_graphical_layout_acceptance', **{**self.options, **options})

    def test_preview_then_apply_and_repeat_preserve_manual_edits(self):
        before = Project.objects.count()
        self.seed()
        self.assertEqual(Project.objects.count(), before)
        self.assertIn('Preview only', self.options['stdout'].getvalue())
        self.seed(apply=True)
        project = Project.objects.get(slug=f'local-graphical-layout-{self.user.pk}')
        self.assertEqual(Field.objects.filter(project=project).count(), 3)
        self.assertEqual(Bed.objects.filter(project=project).count(), 3)
        self.assertFalse(FieldLayout.objects.filter(project=project).exists())
        bed = Bed.objects.filter(project=project).first()
        bed.name = 'Manual acceptance edit'
        bed.save()
        self.seed(apply=True)
        bed.refresh_from_db()
        self.assertEqual(bed.name, 'Manual acceptance edit')
        self.assertEqual(Project.objects.count(), before + 1)

    def test_opt_in_target_confirmation_and_active_user_are_required(self):
        before = Project.objects.count()
        for options in [dict(database_name='wrong'), dict(username='missing')]:
            with self.assertRaises(CommandError):
                self.seed(apply=True, **options)
        with patch.dict('os.environ', {'OFP_LOCAL_TEST_DATA': ''}), self.assertRaises(CommandError):
            self.seed(apply=True)
        with patch.dict(connection.settings_dict, {
            'ENGINE': 'django.db.backends.postgresql', 'HOST': 'remote.example',
        }), self.assertRaises(CommandError):
            self.seed(apply=True)
        self.assertEqual(Project.objects.count(), before)

    def test_slug_collision_does_not_claim_or_modify_existing_project(self):
        project = Project.objects.create(
            slug=f'local-graphical-layout-{self.user.pk}', name='Existing',
        )
        with self.assertRaises(CommandError):
            self.seed(apply=True)
        project.refresh_from_db()
        self.assertEqual(project.name, 'Existing')
        self.assertFalse(Field.objects.filter(project=project).exists())
