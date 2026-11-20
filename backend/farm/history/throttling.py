"""Request limits for the full project history preview."""

from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle


class ProjectRestorePreviewUserThrottle(UserRateThrottle):
    scope = 'project_restore_preview_user'


class ProjectRestorePreviewIpThrottle(SimpleRateThrottle):
    scope = 'project_restore_preview_ip'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}
