from django.contrib import admin

from .models import PlantFamily, PlantFamilyTranslation


class PlantFamilyTranslationInline(admin.TabularInline):
    model = PlantFamilyTranslation
    extra = 0


@admin.register(PlantFamily)
class PlantFamilyAdmin(admin.ModelAdmin):
    """The curated plant-family list is maintained here only; users cannot edit it."""

    list_display = ('botanical_name', 'default_rotation_break_years')
    search_fields = ('botanical_name', 'translations__name')
    inlines = [PlantFamilyTranslationInline]

    def get_readonly_fields(self, request, obj=None):
        # Crops reference the botanical name as the primary key; renaming it
        # in place would orphan every reference, so it is fixed once created.
        return ('botanical_name',) if obj is not None else ()
