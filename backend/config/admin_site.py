"""Admin site that keeps the superuser-only Nutzungsübersicht reachable everywhere.

Django builds both the admin index and the persistent nav sidebar from
`AdminSite.get_app_list`, so adding the dashboard there is the single place
that makes it reachable from any admin page instead of only from the projects
changelist.
"""

from typing import Any

from django.contrib.admin import AdminSite
from django.contrib.admin.apps import AdminConfig
from django.http import HttpRequest
from django.urls import NoReverseMatch, reverse
from django.utils.translation import gettext_lazy as _


class OpenFarmPlannerAdminSite(AdminSite):
    """Default admin site with the engagement dashboard listed under Farm."""

    def get_app_list(
        self,
        request: HttpRequest,
        app_label: str | None = None,
    ) -> list[dict[str, Any]]:
        """Append the dashboard link to the Farm app, for superusers only."""
        app_list = super().get_app_list(request, app_label)
        if not request.user.is_superuser:
            return app_list
        try:
            dashboard_url = reverse(
                f'{self.name}:farm_project_engagement',
                current_app=self.name,
            )
        except NoReverseMatch:
            return app_list
        for app in app_list:
            if app.get('app_label') != 'farm':
                continue
            app['models'].append({
                'model': None,
                'name': _('Nutzungsübersicht'),
                'object_name': 'EngagementDashboard',
                'perms': {'add': False, 'change': False, 'delete': False, 'view': True},
                'admin_url': dashboard_url,
                'add_url': None,
                'view_only': True,
            })
        return app_list


class OpenFarmPlannerAdminConfig(AdminConfig):
    """Install `OpenFarmPlannerAdminSite` as the default `admin.site`."""

    default_site = 'config.admin_site.OpenFarmPlannerAdminSite'
