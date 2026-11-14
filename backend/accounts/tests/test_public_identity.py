import ast
import inspect
from types import SimpleNamespace

from django.test import TestCase

from accounts.public_identity import get_public_user_label


class PublicUserLabelTest(TestCase):
    def test_only_explicit_public_profile_name_is_exposed(self) -> None:
        private = {
            'username': 'private-login', 'email': 'private@example.test', 'first_name': 'Private',
        }
        users = (None, SimpleNamespace(**private), SimpleNamespace(**private, public_profile=None))
        for user in users:
            with self.subTest(user=user):
                self.assertEqual(get_public_user_label(user), '')
        user = SimpleNamespace(**private, public_profile=SimpleNamespace(public_display_name=''))
        self.assertEqual(get_public_user_label(user), '')
        user.public_profile.public_display_name = 'Grüner Hof'
        self.assertEqual(get_public_user_label(user), 'Grüner Hof')

    def test_legacy_serializer_import_and_pseudonyms_keep_the_same_policy(self) -> None:
        import crops.serializers
        from accounts.serializers import UserSerializer
        from crops.serializers import get_public_user_label as species_label
        from farm.crops.serializers.public import get_public_user_label as legacy_label
        from farm.services.public_pseudonyms import has_public_name, number_anonymous_authors

        self.assertIs(species_label, get_public_user_label)
        self.assertIs(legacy_label, get_public_user_label)
        named = SimpleNamespace(pk=1, public_profile=SimpleNamespace(public_display_name='Public'))
        unnamed = SimpleNamespace(pk=2, username='private')
        self.assertTrue(has_public_name(named))
        self.assertFalse(has_public_name(unnamed))
        self.assertEqual(number_anonymous_authors([None, named, unnamed, unnamed]), {2: 1})
        self.assertEqual(UserSerializer().get_public_display_name(named), 'Public')
        self.assertEqual(UserSerializer().get_public_display_name(unnamed), '')
        imports = ast.walk(ast.parse(inspect.getsource(crops.serializers)))
        self.assertFalse(any(
            isinstance(node, ast.ImportFrom) and node.module == 'farm.crops.serializers.public'
            for node in imports
        ))
