"""Enable PostgreSQL trigram search for the official species picker.

`crops.services.search_crop_species` uses `word_similarity()` (from the
`pg_trgm` extension) to fuzzy-match typos against `CropSpecies.name_normalized`
and `CropSpeciesTranslation.search_text_normalized`. That function and its
supporting GIN indexes are PostgreSQL-only; on SQLite (tests/dev) the search
falls back to a Python implementation with the same rank/similarity contract,
so this migration is a deliberate no-op there rather than an error.
"""
from django.db import migrations


def enable_pg_trgm(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')


def create_trigram_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute(
        'CREATE INDEX IF NOT EXISTS crops_cropspecies_name_normalized_trgm '
        'ON crops_cropspecies USING gin (name_normalized gin_trgm_ops)',
    )
    schema_editor.execute(
        'CREATE INDEX IF NOT EXISTS crops_cropspeciestranslation_search_text_trgm '
        'ON crops_cropspeciestranslation USING gin (search_text_normalized gin_trgm_ops)',
    )


def drop_trigram_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute('DROP INDEX IF EXISTS crops_cropspecies_name_normalized_trgm')
    schema_editor.execute('DROP INDEX IF EXISTS crops_cropspeciestranslation_search_text_trgm')


class Migration(migrations.Migration):

    dependencies = [
        ('crops', '0016_endive_search_aliases'),
    ]

    operations = [
        migrations.RunPython(enable_pg_trgm, migrations.RunPython.noop),
        migrations.RunPython(create_trigram_indexes, drop_trigram_indexes),
    ]
