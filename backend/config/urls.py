"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from farm.agent_api.schema_views import PublicRedocView, PublicSchemaView, PublicSwaggerView
from farm.projects.views import agent_login_consume_view

def _with_prefix(path_suffix: str) -> str:
    """Build a URL path suffix with optional deployment prefix."""
    prefix = getattr(settings, 'URL_PREFIX', '').strip('/')
    clean_suffix = path_suffix.lstrip('/')
    return f'{prefix}/{clean_suffix}' if prefix else clean_suffix

urlpatterns = [
    path(_with_prefix('admin/'), admin.site.urls),
    # Published API reference (docs/api.md). Registered before the `api/`
    # include so no router route can shadow these fixed paths. Deliberately
    # not mirrored under the legacy prefix below.
    path(_with_prefix('api/schema/'), PublicSchemaView.as_view(), name='api-schema'),
    path(
        _with_prefix('api/docs/'),
        PublicRedocView.as_view(url_name='api-schema'),
        name='api-docs',
    ),
    path(
        _with_prefix('api/docs/swagger/'),
        PublicSwaggerView.as_view(url_name='api-schema'),
        name='api-docs-swagger',
    ),
    # Registered exactly once, unlike the legacy-prefixed duplicates below:
    # the OAuth redirect URIs are reversed from these names and must resolve
    # to the single path registered with Google/Microsoft.
    path(_with_prefix('api/auth/social/'), include('accounts.social_urls')),
    path(_with_prefix('api/auth/'), include('accounts.urls')),
    path(_with_prefix('api/'), include('farm.urls')),
    # Additive, forward-looking crop-library surface — see
    # docs/crop-library-architecture.md. Not yet public: same
    # IsAuthenticated requirement as everything else. It lives on
    # `/api/crop-library/` because `/api/crops/` now serves the project-owned
    # `farm.Crop` rows (formerly `/api/cultures/`).
    path(_with_prefix('api/crop-library/'), include('crops.urls')),
    path(_with_prefix('api/crop-species/'), include('crops.species_urls')),
    path(_with_prefix('api/crop-library-tokens/'), include('crops.token_urls')),
    path(_with_prefix('api/public-library/'), include('crops.moderation_urls')),
    path(_with_prefix('api/notifications/'), include('notifications.urls')),
    path(_with_prefix('agent-login/<str:token>/'), agent_login_consume_view, name='agent-login-consume'),
]

legacy_prefix = 'openfarmplanner'
if getattr(settings, 'URL_PREFIX', '').strip('/') != legacy_prefix:
    urlpatterns += [
        path(f'{legacy_prefix}/api/auth/', include('accounts.urls')),
        path(f'{legacy_prefix}/api/', include('farm.urls')),
        path(f'{legacy_prefix}/api/crop-library/', include('crops.urls')),
        path(f'{legacy_prefix}/api/crop-species/', include('crops.species_urls')),
        path(f'{legacy_prefix}/api/crop-library-tokens/', include('crops.token_urls')),
        path(f'{legacy_prefix}/api/public-library/', include('crops.moderation_urls')),
        path(f'{legacy_prefix}/api/notifications/', include('notifications.urls')),
        path(f'{legacy_prefix}/agent-login/<str:token>/', agent_login_consume_view, name='agent-login-consume-legacy'),
    ]

if getattr(settings, 'DEBUG', False) and getattr(settings, 'E2E_TEST_TOKEN', ''):
    urlpatterns.append(path(_with_prefix('api/'), include('farm.e2e_urls')))
    if getattr(settings, 'URL_PREFIX', '').strip('/') != legacy_prefix:
        urlpatterns.append(path(f'{legacy_prefix}/api/', include('farm.e2e_urls')))

# Debug Toolbar URLs nur in lokaler Entwicklung (siehe DEBUG_TOOLBAR_ENABLED).
if getattr(settings, 'DEBUG_TOOLBAR_ENABLED', False):
    import debug_toolbar
    urlpatterns = [
        path('__debug__/', include(debug_toolbar.urls)),
    ] + urlpatterns


if getattr(settings, 'DEBUG', False):
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
