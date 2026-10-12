from rest_framework.routers import DefaultRouter

from .views import PlantFamilyViewSet

router = DefaultRouter()
router.register(r'', PlantFamilyViewSet, basename='plant-family')

urlpatterns = router.urls
