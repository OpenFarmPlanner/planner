from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('farm', '0167_location_path_spacing')]

    operations = [
        migrations.AddField(
            model_name='bedlayout',
            name='runs_across_parcel',
            field=models.BooleanField(default=False),
        ),
    ]
