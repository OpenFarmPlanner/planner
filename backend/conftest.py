"""Suite-wide pytest fixtures."""

import pytest
from django.db import DatabaseError, OperationalError, ProgrammingError, transaction


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
    A later class on the same xdist worker would fail on a missing family.
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


def snapshot_seeded_crop_species() -> str:
    """Capture taxonomy from the migrated test database, without another seed source."""
    from itertools import chain

    from django.core import serializers

    from crops.models import CropSpecies, CropSpeciesTranslation

    return serializers.serialize('json', chain(
        CropSpecies.objects.order_by('pk'),
        CropSpeciesTranslation.objects.order_by('pk'),
    ))


def ensure_seeded_crop_species(snapshot: str) -> None:
    """Restore migrated taxonomy only when a transaction-test flush removed it."""
    from django.core import serializers

    from crops.models import CropSpecies

    if CropSpecies.objects.exists():
        return
    with transaction.atomic():
        for record in serializers.deserialize('json', snapshot):
            record.save()


@pytest.fixture(scope='session')
def _migrated_crop_species(django_db_setup, django_db_blocker):
    with django_db_blocker.unblock():
        return snapshot_seeded_crop_species()


@pytest.fixture(autouse=True, scope='class')
def _restore_seeded_crop_species(
    _migrated_crop_species, _restore_seeded_plant_families, django_db_blocker,
):
    """Give each class the taxonomy its worker's migrations initially provided."""
    with django_db_blocker.unblock():
        try:
            ensure_seeded_crop_species(_migrated_crop_species)
        except (OperationalError, ProgrammingError):
            # Match the family fixture while a migration test has an older schema.
            pass
