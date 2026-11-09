from django.test import SimpleTestCase

from config.cache import FailOpenRedisCache


class FailOpenRedisCacheTests(SimpleTestCase):
    """Port 1 refuses connections, so these exercise a real Redis failure."""

    def setUp(self) -> None:
        self.cache = FailOpenRedisCache(
            'redis://127.0.0.1:1/1',
            {'OPTIONS': {'socket_connect_timeout': 1, 'socket_timeout': 1}},
        )

    def test_get_returns_the_default(self) -> None:
        with self.assertLogs('config.cache', level='WARNING'):
            self.assertEqual(self.cache.get('key', ['fallback']), ['fallback'])

    def test_set_does_not_raise(self) -> None:
        with self.assertLogs('config.cache', level='WARNING'):
            self.cache.set('key', 1, timeout=60)

    def test_add_reports_nothing_was_added(self) -> None:
        with self.assertLogs('config.cache', level='WARNING'):
            self.assertFalse(self.cache.add('key', 1))

    def test_delete_reports_nothing_was_deleted(self) -> None:
        with self.assertLogs('config.cache', level='WARNING'):
            self.assertFalse(self.cache.delete('key'))

    def test_incr_behaves_like_a_missing_key(self) -> None:
        with self.assertLogs('config.cache', level='WARNING'), self.assertRaises(ValueError):
            self.cache.incr('key')
