"""Session-authenticated endpoints for crop deletion previews and recovery."""

from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from config.responses import api_error_response
from farm.history import _current_actor_label
from farm.project_context import get_active_project_or_400
from farm.services.crop_deletion import (
    MAX_BULK_CROPS,
    BulkCropDeletionConflict,
    CropDeletionSelection,
    delete_project_crops,
    preview_crop_deletion,
    recover_crop_deletion,
)


class BulkCropDeletionSelectionSerializer(serializers.Serializer):
    expected_project_id = serializers.IntegerField(min_value=1)
    scope = serializers.ChoiceField(choices=("selected", "all"))
    crop_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), max_length=MAX_BULK_CROPS,
        required=False,
    )
    delete_varieties = serializers.BooleanField(default=True)

    def validate(self, attrs):
        ids = attrs.get("crop_ids", [])
        if attrs["scope"] == "selected" and not ids:
            raise serializers.ValidationError({"crop_ids": "Select at least one crop."})
        if attrs["scope"] == "all" and ids:
            raise serializers.ValidationError({"crop_ids": "Delete all does not take crop IDs."})
        return attrs

    @property
    def selection(self):
        data = self.validated_data
        return CropDeletionSelection(
            data["scope"], tuple(sorted(set(data.get("crop_ids", ())))), data["delete_varieties"],
        )


class BulkCropDeletionSerializer(BulkCropDeletionSelectionSerializer):
    request_id = serializers.UUIDField()
    preview_token = serializers.CharField(max_length=256)
    confirm_all = serializers.BooleanField(default=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs["scope"] == "all" and not attrs["confirm_all"]:
            raise serializers.ValidationError({"confirm_all": "Confirm deletion of all crops."})
        return attrs


class BulkCropRecoverySerializer(serializers.Serializer):
    expected_project_id = serializers.IntegerField(min_value=1)
    batch_id = serializers.IntegerField(min_value=1)


class BulkCropDeletionIpThrottle(SimpleRateThrottle):
    scope = "crop_bulk_delete_ip"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


def bulk_crop_deletion_error(exc: BulkCropDeletionConflict) -> Response:
    counts = {}
    if exc.preview is not None:
        blocked = exc.preview["blocked_count"]
        counts = {
            "blocked_count": blocked,
            "skipped_count": (
                exc.preview["affected_count"] + exc.preview["missing_count"]
                - blocked - exc.failed_count
            ),
            "failed_count": exc.failed_count,
        }
    return api_error_response(
        code=exc.code, detail=str(exc), status_code=status.HTTP_409_CONFLICT, deleted_count=0,
        **counts,
    )


class BulkCropDeletionViewBase(APIView):
    throttle_scope = "crop_bulk_delete_user"
    throttle_classes = [*APIView.throttle_classes, BulkCropDeletionIpThrottle]

    @staticmethod
    def project_changed(project, data):
        if project.pk != data["expected_project_id"]:
            return api_error_response(
                code="crop_bulk_delete_project_changed",
                detail="The active project changed. Return to the intended project.",
                status_code=status.HTTP_409_CONFLICT,
            )
        return None


class BulkCropDeletionPreviewView(BulkCropDeletionViewBase):
    def post(self, request):
        project = get_active_project_or_400(request)
        serializer = BulkCropDeletionSelectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        changed = self.project_changed(project, serializer.validated_data)
        if changed is not None:
            return changed
        try:
            return Response(preview_crop_deletion(
                project, actor_id=request.user.pk, selection=serializer.selection,
            ))
        except BulkCropDeletionConflict as exc:
            return bulk_crop_deletion_error(exc)


class BulkCropDeletionView(BulkCropDeletionViewBase):
    def post(self, request):
        project = get_active_project_or_400(request)
        serializer = BulkCropDeletionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        changed = self.project_changed(project, data)
        if changed is not None:
            return changed
        try:
            result = delete_project_crops(
                project, user=request.user, actor_label=_current_actor_label(request),
                selection=serializer.selection, request_id=data["request_id"],
                preview_token=data["preview_token"],
            )
        except BulkCropDeletionConflict as exc:
            return bulk_crop_deletion_error(exc)
        return Response({**result, "blocked_count": 0, "skipped_count": 0, "failed_count": 0})


class BulkCropRecoveryView(BulkCropDeletionViewBase):
    def post(self, request):
        project = get_active_project_or_400(request)
        serializer = BulkCropRecoverySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        changed = self.project_changed(project, data)
        if changed is not None:
            return changed
        try:
            restored = recover_crop_deletion(
                project, data["batch_id"], user=request.user,
                actor_label=_current_actor_label(request),
            )
        except BulkCropDeletionConflict as exc:
            return bulk_crop_deletion_error(exc)
        return Response({"restored_count": restored})
