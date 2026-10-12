"""Suite-wide pytest fixtures."""

import pytest
from django.db import DatabaseError


def ensure_seeded_plant_families() -> None:
    """Re-seed the plant-family list if a database flush removed it."""
    from crops.models import PlantFamily, PlantFamilyTranslation
    from crops.plant_families import seed_plant_families

    if not PlantFamily.objects.exists():
        seed_plant_families(PlantFamily, PlantFamilyTranslation)


@pytest.fixture(autouse=True, scope='class')
def _restore_seeded_plant_families(django_db_setup, django_db_blocker):
    """Put the seeded plant-family list back before each test class.

    A ``transaction=True`` test (every migration test) flushes all tables on
    teardown, which also removes the families migration ``crops.0019`` seeds.
    Unlike the seeded crop species, crops reference these rows by foreign key,
    so a later class on the same xdist worker would fail on a missing family.
    Class scope runs before ``setUpClass``/``setUpTestData``; a transactional
    class that needs the families between its own tests re-seeds itself
    (see ``ensure_seeded_plant_families``).
    """
    with django_db_blocker.unblock():
        try:
            ensure_seeded_plant_families()
        except DatabaseError:
            # Schema left migrated backwards; the next migration test's own
            # teardown migrates forward again.
            pass
