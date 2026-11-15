from rest_framework.routers import DefaultRouter

from .plant_health_views import PlantHealthEntryViewSet, PlantHealthHostViewSet

router = DefaultRouter()
router.register("entries", PlantHealthEntryViewSet, basename="plant-health-entry")
router.register("hosts", PlantHealthHostViewSet, basename="plant-health-host")
urlpatterns = router.urls
