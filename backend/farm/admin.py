"""Django admin configuration for farm models.

This module configures the Django admin interface for all farm models,
providing customized list displays, filters, and search capabilities.
"""

from dataclasses import replace

from django.conf import settings
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.http import HttpRequest, HttpResponse
from django.template.response import TemplateResponse
from django.urls import URLPattern, URLResolver, path, reverse
from django.utils.html import format_html
from django.utils.translation import gettext as _

from .models import (
    AgentLoginToken,
    Bed,
    BedLayout,
    Crop,
    EntityRevision,
    Feedback,
    Field,
    FieldLayout,
    Location,
    NoteAttachment,
    PlantingPlan,
    Project,
    ProjectInvitation,
    ProjectMembership,
    ProjectRevision,
    SeedPackage,
    Supplier,
    Task,
)
from .services.engagement_dashboard import (
    PROJECT_SORT_FIELDS,
    build_engagement_dashboard,
    sort_project_rows,
)


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    """Admin interface configuration for Project model."""

    list_display = ['name', 'slug', 'is_active', 'created_at']
    list_filter = ['is_active']
    search_fields = ['name', 'slug']
    change_list_template = 'admin/farm/project/change_list.html'

    def get_urls(self) -> list[URLPattern | URLResolver]:
        """Add the superuser-only aggregated engagement dashboard."""
        custom_urls = [
            path(
                'engagement/',
                self.admin_site.admin_view(self.engagement_dashboard_view),
                name='farm_project_engagement',
            ),
        ]
        return custom_urls + super().get_urls()

    def engagement_dashboard_view(self, request: HttpRequest) -> HttpResponse:
        """Show internal aggregates; never extend this to individual behavior tracking."""
        if not request.user.is_superuser:
            raise PermissionDenied
        dashboard = build_engagement_dashboard()
        order_param = request.GET.get('o', '')
        descending = order_param.startswith('-')
        sort_key = order_param[1:] if descending else order_param
        if sort_key in PROJECT_SORT_FIELDS:
            dashboard = replace(
                dashboard,
                projects=sort_project_rows(dashboard.projects, sort_key, descending=descending),
            )
        else:
            sort_key = ''
        context = {
            **self.admin_site.each_context(request),
            'title': _('Nutzungsübersicht'),
            'dashboard': dashboard,
            'project_columns': self._project_column_headers(sort_key, descending),
            'opts': self.model._meta,
        }
        return TemplateResponse(request, 'admin/farm/engagement_dashboard.html', context)

    @staticmethod
    def _project_column_headers(current_sort_key: str, descending: bool) -> dict[str, dict[str, object]]:
        """Build Django-admin-style sortable header state for the "Projekte" table.

        Mirrors the `sorted`/`sortoptions`/`toggle` markup and CSS classes from
        Django's own `admin/change_list_results.html` so the headers look and
        behave like the sortable columns on other admin list pages (e.g. users).
        """
        columns = {}
        for key in PROJECT_SORT_FIELDS:
            is_sorted = key == current_sort_key
            ascending = is_sorted and not descending
            columns[key] = {
                'is_sorted': is_sorted,
                'ascending': ascending,
                'url_primary': f'?o={key}',
                'url_toggle': f'?o={"-" if ascending else ""}{key}',
                'url_remove': '?',
            }
        return columns


@admin.register(ProjectMembership)
class ProjectMembershipAdmin(admin.ModelAdmin):
    """Admin interface configuration for ProjectMembership model."""

    list_display = ['user', 'project', 'role', 'created_at']
    list_filter = ['role', 'project']
    search_fields = ['user__email', 'user__username', 'project__name', 'project__slug']


@admin.register(ProjectInvitation)
class ProjectInvitationAdmin(admin.ModelAdmin):
    """Admin interface configuration for ProjectInvitation model."""

    list_display = ['email', 'project', 'role', 'status', 'invited_by', 'expires_at', 'created_at']
    list_filter = ['status', 'role', 'project']
    search_fields = ['email', 'email_normalized', 'project__name', 'project__slug']


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    """Admin interface configuration for Supplier model.
    
    Provides a customized admin interface with search and display
    capabilities for seed suppliers.
    
    Attributes:
        list_display: Fields to display in the list view
        search_fields: Fields to include in the search functionality
        readonly_fields: Fields that cannot be edited in the admin
    """
    list_display = ['name', 'project', 'name_normalized', 'created_at']
    list_filter = ['project']
    search_fields = ['name', 'name_normalized', 'project__name', 'project__slug']
    readonly_fields = ['name_normalized']


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    """Admin interface configuration for Location model.
    
    Provides a customized admin interface with search and display
    capabilities for farm locations.
    
    Attributes:
        list_display: Fields to display in the list view
        search_fields: Fields to include in the search functionality
    """
    list_display = ['name', 'project', 'address', 'soil_type', 'exposure', 'created_at']
    list_filter = ['project']
    search_fields = ['name', 'address', 'description', 'project__name', 'project__slug']


@admin.register(Field)
class FieldAdmin(admin.ModelAdmin):
    """Admin interface configuration for Field model.
    
    Provides a customized admin interface with filtering, search,
    and display capabilities for fields.
    
    Attributes:
        list_display: Fields to display in the list view
        list_filter: Fields to use for filtering the list
        search_fields: Fields to include in the search functionality
    """
    list_display = ['name', 'project', 'location', 'area_sqm', 'created_at']
    list_filter = ['project', 'location']
    search_fields = ['name', 'location__name', 'project__name', 'project__slug']


@admin.register(Bed)
class BedAdmin(admin.ModelAdmin):
    """Admin interface configuration for Bed model.
    
    Provides a customized admin interface with hierarchical filtering,
    search, and display capabilities for beds.
    
    Attributes:
        list_display: Fields to display in the list view
        list_filter: Fields to use for filtering the list (includes location hierarchy)
        search_fields: Fields to include in the search functionality
    """
    list_display = ['name', 'project', 'field', 'area_sqm', 'created_at']
    list_filter = ['project', 'field__location', 'field']
    search_fields = ['name', 'field__name', 'project__name', 'project__slug']


@admin.register(BedLayout)
class BedLayoutAdmin(admin.ModelAdmin):
    """Admin interface configuration for BedLayout model."""

    list_display = ['bed', 'location', 'project', 'version', 'created_at']
    list_filter = ['project', 'location']
    search_fields = ['bed__name', 'bed__field__name', 'location__name', 'project__name', 'project__slug']


@admin.register(FieldLayout)
class FieldLayoutAdmin(admin.ModelAdmin):
    """Admin interface configuration for FieldLayout model."""

    list_display = ['field', 'location', 'project', 'version', 'created_at']
    list_filter = ['project', 'location']
    search_fields = ['field__name', 'location__name', 'project__name', 'project__slug']


@admin.register(Crop)
class CropAdmin(admin.ModelAdmin):
    """Admin interface configuration for Crop model.
    
    Provides a customized admin interface with search and display
    capabilities for crops.
    
    Attributes:
        list_display: Fields to display in the list view
        search_fields: Fields to include in the search functionality
    """
    list_display = [
        'name', 'variety', 'project',
        'seed_rate_value', 'seed_rate_unit',
        'sowing_calculation_safety_percent',
        'seeding_requirement', 'seeding_requirement_type',
        'created_at'
    ]
    list_filter = ['project']
    search_fields = [
        'name', 'variety',
        'seed_rate_unit', 'seeding_requirement_type',
        'project__name', 'project__slug'
    ]


@admin.register(ProjectRevision)
class ProjectRevisionAdmin(admin.ModelAdmin):
    """Admin interface for the deprecated ProjectRevision model (draining via cleanup_history)."""

    list_display = ['id', 'project', 'summary', 'created_at']
    list_filter = ['project']
    search_fields = ['summary', 'project__name', 'project__slug']


@admin.register(EntityRevision)
class EntityRevisionAdmin(admin.ModelAdmin):
    """Admin interface configuration for EntityRevision model."""

    list_display = ['id', 'project', 'entity_type', 'object_id', 'action', 'display_name', 'created_at']
    list_filter = ['project', 'entity_type', 'action']
    search_fields = ['display_name', 'project__name', 'project__slug']


@admin.register(SeedPackage)
class SeedPackageAdmin(admin.ModelAdmin):
    """Admin interface configuration for SeedPackage model."""

    list_display = ['crop', 'size_value', 'size_unit', 'project', 'updated_at']
    list_filter = ['project', 'size_unit']
    search_fields = ['crop__name', 'crop__variety', 'project__name', 'project__slug']


@admin.register(PlantingPlan)
class PlantingPlanAdmin(admin.ModelAdmin):
    """Admin interface configuration for PlantingPlan model.
    
    Provides a customized admin interface with date hierarchy, filtering,
    search, and display capabilities for planting plans. The harvest_date
    field is read-only as it's auto-calculated.
    
    Attributes:
        list_display: Fields to display in the list view
        list_filter: Fields to use for filtering the list
        search_fields: Fields to include in the search functionality
        date_hierarchy: Field to use for date-based navigation
        readonly_fields: Fields that cannot be edited in the admin
    """
    list_display = ['crop', 'bed', 'project', 'planting_date', 'harvest_date', 'quantity', 'created_at']
    list_filter = ['project', 'crop', 'bed__field__location']
    search_fields = ['crop__name', 'bed__name', 'project__name', 'project__slug']
    date_hierarchy = 'planting_date'
    readonly_fields = ['harvest_date']


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    """Admin interface configuration for Task model.
    
    Provides a customized admin interface with date hierarchy, status filtering,
    search, and display capabilities for farm tasks.
    
    Attributes:
        list_display: Fields to display in the list view
        list_filter: Fields to use for filtering the list
        search_fields: Fields to include in the search functionality
        date_hierarchy: Field to use for date-based navigation
    """
    list_display = ['title', 'project', 'status', 'due_date', 'planting_plan', 'created_at']
    list_filter = ['project', 'status']
    search_fields = ['title', 'description', 'project__name', 'project__slug']
    date_hierarchy = 'due_date'


@admin.register(NoteAttachment)
class NoteAttachmentAdmin(admin.ModelAdmin):
    """Admin interface configuration for NoteAttachment model."""

    list_display = ['id', 'planting_plan', 'project', 'created_at']
    list_filter = ['project']
    search_fields = ['caption', 'planting_plan__crop__name', 'planting_plan__bed__name', 'project__name', 'project__slug']


@admin.register(AgentLoginToken)
class AgentLoginTokenAdmin(admin.ModelAdmin):
    """Admin interface for generating reusable project-bound agent login links."""

    list_display = ['id', 'project', 'created_by', 'expires_at', 'used_at', 'created_at']
    list_filter = ['project', 'created_by', 'used_at']
    search_fields = ['project__name', 'project__slug', 'created_by__email', 'created_by__username']
    readonly_fields = ['token_hash', 'created_by', 'created_at', 'used_at', 'used_by_ip', 'used_user_agent']
    fields = ['project', 'expires_at', 'token_hash', 'created_by', 'created_at', 'used_at', 'used_by_ip', 'used_user_agent']

    _admin_request_link_attr = '_agent_login_absolute_link'
    _admin_request_token_attr = '_agent_login_plain_token'

    def has_module_permission(self, request):  # noqa: ANN001
        return bool(getattr(settings, 'AGENT_LOGIN_ENABLED', False) and request.user.is_superuser)

    def has_view_permission(self, request, obj=None):  # noqa: ANN001, ARG002
        return self.has_module_permission(request)

    def has_add_permission(self, request):  # noqa: ANN001
        return self.has_module_permission(request)

    def has_change_permission(self, request, obj=None):  # noqa: ANN001, ARG002
        return self.has_module_permission(request)

    def save_model(self, request, obj, form, change):  # noqa: ANN001
        if not request.user.is_superuser:
            raise PermissionDenied('Only superusers can generate agent login links.')
        if not getattr(settings, 'AGENT_LOGIN_ENABLED', False):
            raise PermissionDenied('Agent login is disabled.')

        if change:
            super().save_model(request, obj, form, change)
            return

        token_obj, raw_token = AgentLoginToken.create_token(
            created_by=request.user,
            project=obj.project,
            expires_at=obj.expires_at,
        )
        obj.pk = token_obj.pk
        obj.created_by = token_obj.created_by
        obj.token_hash = token_obj.token_hash
        obj.created_at = token_obj.created_at
        obj.used_at = token_obj.used_at
        obj.expires_at = token_obj.expires_at

        consume_path = reverse('agent-login-consume', kwargs={'token': raw_token})
        absolute_link = request.build_absolute_uri(consume_path)
        setattr(request, self._admin_request_link_attr, absolute_link)
        setattr(request, self._admin_request_token_attr, raw_token)

    def response_add(self, request, obj, post_url_continue=None):  # noqa: ANN001
        plain_link = getattr(request, self._admin_request_link_attr, '')
        plain_token = getattr(request, self._admin_request_token_attr, '')
        if plain_link and plain_token:
            self.message_user(
                request,
                format_html(
                    'Agent login link (reusable until expiry): <code>{}</code><br>'
                    'Plain token: <code>{}</code><br>'
                    '<strong>This is the only time the plain token is shown.</strong> '
                    'Later only the hash is stored, and the hash cannot be used for login.',
                    plain_link,
                    plain_token,
                ),
                level=messages.SUCCESS,
            )
        return super().response_add(request, obj, post_url_continue)


@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    """Read-oriented admin view over the in-app feedback history."""

    list_display = ['created_at', 'category', 'project_name', 'user', 'contact_consent']
    list_filter = ['category', 'contact_consent']
    search_fields = ['message', 'project_name', 'user__email', 'contact_email']
    readonly_fields = [
        'category',
        'message',
        'user',
        'project',
        'project_name',
        'route',
        'browser_info',
        'contact_consent',
        'contact_email',
        'created_at',
        'updated_at',
    ]
