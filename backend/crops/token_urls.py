from rest_framework.routers import DefaultRouter

from .agent_api.views import CropLibraryApiTokenViewSet

router = DefaultRouter()
router.register(r'', CropLibraryApiTokenViewSet, basename='crop-library-api-token')

urlpatterns = router.urls
