"""Accounts admin module."""

from allauth.account.models import EmailAddress
from django.contrib import admin
from django.contrib.admin.sites import NotRegistered
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.db.models import Exists, F, OuterRef, QuerySet
from django.http import HttpRequest
from django.utils.translation import gettext_lazy as _

from .models import UserProjectSettings

User = get_user_model()

try:
    admin.site.unregister(User)
except NotRegistered:
    pass


class OpenFarmPlannerUserAdmin(DjangoUserAdmin):
    """Custom admin interface configuration for the built-in Django user model."""

    list_display = [
        *DjangoUserAdmin.list_display,
        'primary_email_verified',
        'date_joined',
        'last_login',
    ]
    readonly_fields = [
        *DjangoUserAdmin.readonly_fields,
        'primary_email_verified',
        'date_joined',
        'last_login',
    ]
    ordering = [F('last_login').desc(nulls_last=True)]
    fieldsets = tuple(
        (
            name,
            {
                **options,
                'fields': (*options['fields'], 'primary_email_verified'),
            },
        )
        if 'email' in options['fields']
        else (name, options)
        for name, options in DjangoUserAdmin.fieldsets
    )

    def get_queryset(self, request: HttpRequest) -> QuerySet:
        """Annotate users with their allauth primary-email verification state."""
        queryset = super().get_queryset(request)
        verified_primary_email = EmailAddress.objects.filter(
            user_id=OuterRef('pk'),
            email__iexact=OuterRef('email'),
            primary=True,
            verified=True,
        )
        return queryset.annotate(_primary_email_verified=Exists(verified_primary_email))

    @admin.display(boolean=True, description=_('Primary email verified'))
    def primary_email_verified(self, obj: User) -> bool:
        """Return whether allauth marks the user's current primary email as verified."""
        return bool(obj._primary_email_verified)


admin.site.register(User, OpenFarmPlannerUserAdmin)


@admin.register(UserProjectSettings)
class UserProjectSettingsAdmin(admin.ModelAdmin):
    """Admin interface configuration for the UserProjectSettings model."""

    list_display = ['user', 'default_project', 'last_project', 'updated_at']
    search_fields = ['user__email', 'user__username', 'default_project__name', 'last_project__name']
