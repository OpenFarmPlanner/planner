from django.db import migrations

# The demo template seeded 1.2 and 1.5 seeds per plant for pre-cultivation
# until #808. Fractions violate the whole-number rule for that unit, so saving
# or re-importing such a demo crop fails. #808 fixed the template only; this
# brings already seeded demo projects to the template's current value. The
# exact old values are matched so nothing a user typed is rewritten, and only
# rows in demo projects are touched.
OLD_SEED_VALUES = (1.2, 1.5)
NEW_SEED_VALUE = 1.0


def repair_demo_seeds_per_plant(apps, schema_editor):
    Crop = apps.get_model('farm', 'Crop')
    Crop.objects.filter(
        project__demo_seeded_at__isnull=False,
        seed_rate_pre_cultivation_unit='seeds_per_plant',
        seed_rate_pre_cultivation_value__in=OLD_SEED_VALUES,
    ).update(seed_rate_pre_cultivation_value=NEW_SEED_VALUE)


class Migration(migrations.Migration):

    dependencies = [
        ('farm', '0118_project_succession_during_harvest'),
    ]

    operations = [
        migrations.RunPython(repair_demo_seeds_per_plant, migrations.RunPython.noop),
    ]
