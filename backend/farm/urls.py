from django.urls import path, include
from rest_framework.routers import DefaultRouter, SimpleRouter
from .agent_api.views import (
    AgentContextView,
    AgentOpenApiSchemaView,
    CropImportApplyView,
    CropImportDraftView,
    CropImportPreviewView,
    ProjectApiTokenViewSet,
)
from .planning.views import (
    PlantingPlanViewSet,
    TaskViewSet,
    YieldCalendarListView,
)
from .seasons.views import (
    SeasonPatternPreviewView,
    SeasonPatternView,
    SeasonSetupApplyView,
    SeasonSetupStatusView,
    SeasonViewSet,
)
from .structure.views import (
    BedLayoutByLocationView,
    BedViewSet,
    FieldViewSet,
    LocationViewSet,
)
from .crops.views import (
    CropCompanionViewSet,
    CropSupplierDataViewSet,
    CropViewSet,
    PublicCropViewSet,
    SeedDemandListView,
    SeedPackageViewSet,
    SupplierViewSet,
    YoungPlantDemandListView,
)
from .history.views import (
    BatchOperationRevertView,
    GlobalHistoryListView,
    GlobalHistoryRestoreView,
    ProjectHistoryListView,
    ProjectHistoryRestoreView,
)
from .notes.views import (
    MediaFileUploadView,
    NoteAttachmentDeleteView,
    NoteAttachmentListCreateView,
)
from .common.views import VersionView
from .feedback.views import FeedbackView
from .projects.views import (
    AcceptPendingProjectInvitationView,
    AcceptProjectInvitationByTokenView,
    AcceptProjectInvitationView,
    MyProjectsView,
    PendingProjectInvitationView,
    ProjectInvitationView,
    ProjectMembersView,
    ProjectSwitchView,
    ProjectViewSet,
    PublicProjectInvitationView,
    RevokeProjectInvitationView,
)

router = DefaultRouter()
router.register(r'locations', LocationViewSet)
router.register(r'suppliers', SupplierViewSet)
router.register(r'fields', FieldViewSet)
router.register(r'beds', BedViewSet)
router.register(r'crops', CropViewSet)
router.register(r'crop-supplier-data', CropSupplierDataViewSet)
router.register(r'crop-companions', CropCompanionViewSet)
router.register(r'public-crops', PublicCropViewSet, basename='public-crops')
router.register(r'seed-packages', SeedPackageViewSet)
router.register(r'planting-plans', PlantingPlanViewSet)
router.register(r'seasons', SeasonViewSet)
router.register(r'tasks', TaskViewSet)
router.register(r'projects', ProjectViewSet, basename='projects')
router.register(r'api-tokens', ProjectApiTokenViewSet, basename='api-tokens')

# Deprecated pre-"Crop" spellings of the renamed endpoints, kept so clients that
# predate the rename keep working: a browser still running the old JS bundle
# across a deploy, and external agents whose integrations we do not control.
# A `SimpleRouter` (no API-root view) keeps them out of the browsable API index
# so only the current names are discoverable. Remove once those clients are
# gone; nothing in this repo calls them.
legacy_router = SimpleRouter()
legacy_router.register(r'cultures', CropViewSet, basename='legacy-cultures')
legacy_router.register(
    r'culture-supplier-data', CropSupplierDataViewSet, basename='legacy-culture-supplier-data'
)
legacy_router.register(r'public-cultures', PublicCropViewSet, basename='legacy-public-cultures')

urlpatterns = [
    path('version/', VersionView.as_view(), name='api-version'),
    path('feedback/', FeedbackView.as_view(), name='feedback'),
    # Agent API: OpenAPI description plus the two-step crop import.
    # Registered before the router so the fixed `preview/` segment is not
    # swallowed by the draft-id route.
    path('agent/context/', AgentContextView.as_view(), name='agent-context'),
    path('agent/openapi.json', AgentOpenApiSchemaView.as_view(), name='agent-openapi-schema'),
    path('crop-imports/preview/', CropImportPreviewView.as_view(), name='crop-import-preview'),
    path('crop-imports/<uuid:draft_id>/', CropImportDraftView.as_view(), name='crop-import-draft'),
    path('crop-imports/<uuid:draft_id>/apply/', CropImportApplyView.as_view(), name='crop-import-apply'),
    # Deprecated aliases (see `legacy_router`). An import draft created before
    # the rename is still applicable after it — migration 0100 rewrites the
    # stored preview payload — so the path that applies it has to survive too.
    path('culture-imports/preview/', CropImportPreviewView.as_view(), name='legacy-crop-import-preview'),
    path('culture-imports/<uuid:draft_id>/', CropImportDraftView.as_view(), name='legacy-crop-import-draft'),
    path('culture-imports/<uuid:draft_id>/apply/', CropImportApplyView.as_view(), name='legacy-crop-import-apply'),
    path('history/project/', ProjectHistoryListView.as_view(), name='project-history-list'),
    path('history/project/restore/', ProjectHistoryRestoreView.as_view(), name='project-history-restore'),
    path('history/batch/<int:batch_id>/revert/', BatchOperationRevertView.as_view(), name='batch-operation-revert'),
    path('history/global/', GlobalHistoryListView.as_view(), name='global-history-list'),
    path('history/global/restore/', GlobalHistoryRestoreView.as_view(), name='global-history-restore'),
    path('media-files/upload/', MediaFileUploadView.as_view(), name='media-file-upload'),
    path('notes/<int:note_id>/attachments/', NoteAttachmentListCreateView.as_view(), name='note-attachments'),
    path('attachments/<int:attachment_id>/', NoteAttachmentDeleteView.as_view(), name='note-attachment-delete'),
    path('seed-demand/', SeedDemandListView.as_view(), name='seed-demand-list'),
    path('young-plant-demand/', YoungPlantDemandListView.as_view(), name='young-plant-demand-list'),
    path('yield-calendar/', YieldCalendarListView.as_view(), name='yield-calendar-list'),
    path('season-pattern/', SeasonPatternView.as_view(), name='season-pattern'),
    path('season-pattern/preview/', SeasonPatternPreviewView.as_view(), name='season-pattern-preview'),
    path('season-setup/status/', SeasonSetupStatusView.as_view(), name='season-setup-status'),
    path('season-setup/apply/', SeasonSetupApplyView.as_view(), name='season-setup-apply'),
    path('locations/<int:location_id>/layouts/', BedLayoutByLocationView.as_view(), name='location-layouts'),
    path('projects-bootstrap/', MyProjectsView.as_view(), name='projects-bootstrap'),
    path('projects-switch/', ProjectSwitchView.as_view(), name='projects-switch'),
    path('projects/<int:project_id>/members/', ProjectMembersView.as_view(), name='project-members'),
    path('projects/<int:project_id>/invitations/', ProjectInvitationView.as_view(), name='project-invitations'),
    path('projects/<int:project_id>/invitations/<int:invitation_id>/revoke/', RevokeProjectInvitationView.as_view(), name='project-invitations-revoke'),
    path('invitations/accept/', AcceptProjectInvitationView.as_view(), name='invitations-accept'),
    path('project-invitations/accept/', AcceptProjectInvitationView.as_view(), name='project-invitations-accept'),
    path('project-invitations/pending/', PendingProjectInvitationView.as_view(), name='project-invitations-pending'),
    path('project-invitations/pending/accept/', AcceptPendingProjectInvitationView.as_view(), name='project-invitations-pending-accept'),
    path('project-invitations/<str:token>/accept/', AcceptProjectInvitationByTokenView.as_view(), name='project-invitations-token-accept'),
    path('project-invitations/<str:token>/', PublicProjectInvitationView.as_view(), name='project-invitations-public'),
    path('', include(router.urls)),
    path('', include(legacy_router.urls)),
]
