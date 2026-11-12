from typing import Any

from django import forms
from django.contrib import admin
from django.http import HttpRequest

from .models import CropSpecies, PlantFamily, PlantFamilyTranslation
from .specific_properties import PROPERTY_PROFILES, specific_property_errors


class CropSpeciesProfileForm(forms.ModelForm):
    specific_property_profile = forms.ChoiceField(required=False)

    class Meta:
        model = CropSpecies
        fields = ('specific_property_profile',)

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.fields['specific_property_profile'].choices = [
            ('', 'No crop-specific properties'),
            *((key, key.replace('_', ' ')) for key in PROPERTY_PROFILES),
        ]

    def clean_specific_property_profile(self) -> str:
        from farm.models import Crop, PublicCrop

        profile = self.cleaned_data['specific_property_profile']
        if self.instance.pk and profile != self.instance.specific_property_profile:
            for model in (Crop, PublicCrop):
                records = model._base_manager.filter(
                    crop_species_id=self.instance.pk,
                ).exclude(specific_properties={})
                property_values = records.values_list('specific_properties', flat=True)
                for values in property_values.iterator(chunk_size=500):
                    if specific_property_errors(values, profile):
                        raise forms.ValidationError(
                            'Existing crop properties are incompatible with this profile.',
                        )
        return profile


@admin.register(CropSpecies)
class CropSpeciesProfileAdmin(admin.ModelAdmin):
    """Maintain structural profiles here; names and translations stay in the API."""

    form = CropSpeciesProfileForm
    list_display = ('name', 'scientific_name', 'specific_property_profile')
    search_fields = ('name', 'scientific_name')
    readonly_fields = ('name', 'scientific_name')
    fields = ('name', 'scientific_name', 'specific_property_profile')

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: CropSpecies | None = None) -> bool:
        return False


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
