"""Global catalogue endpoints; project-bound tokens deliberately never opt in."""

from __future__ import annotations

from typing import Any

from django.contrib.auth import get_user_model
from django.db.models import Exists, Min, OuterRef, Q, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.demo_access import guest_demo_forbidden_response, is_active_guest_demo_user
from farm.services.public_pseudonyms import number_anonymous_authors
from farm.utils import normalize_text

from .agent_api.permissions import CropLibraryTokenAccessPermission
from .permissions import is_public_library_moderator
from .plant_health_models import PlantHealthEntry, PlantHealthHost, PlantHealthTranslation
from .plant_health_serializers import (
    PlantHealthEntrySerializer,
    PlantHealthHostSerializer,
    PlantHealthRevisionSerializer,
)
from .plant_health_services import catalogue_queryset, write_entry, write_host


class CatalogueModeratorWritePermission(permissions.BasePermission):
    def has_permission(self, request: Request, view: Any) -> bool:
        return request.method in permissions.SAFE_METHODS or is_public_library_moderator(
            request.user
        )


class PlantHealthEntryViewSet(viewsets.ModelViewSet):
    serializer_class = PlantHealthEntrySerializer
    permission_classes = [permissions.IsAuthenticated, CropLibraryTokenAccessPermission]
    crop_library_token_actions = {"list", "retrieve", "create", "update", "partial_update"}
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self) -> QuerySet[PlantHealthEntry]:
        queryset = catalogue_queryset()
        moderator = is_public_library_moderator(self.request.user)
        include_proposed = self.request.query_params.get("include_proposed") in {"true", "1"}
        requested_status = self.request.query_params.get("status", "")
        if moderator and self.action != "list":
            pass
        elif moderator and requested_status:
            queryset = queryset.filter(status=requested_status)
        elif moderator and include_proposed:
            pass
        elif include_proposed or self.action == "retrieve":
            queryset = queryset.filter(
                Q(status=PlantHealthEntry.STATUS_PUBLISHED)
                | Q(status=PlantHealthEntry.STATUS_PROPOSED, proposed_by=self.request.user),
            )
        else:
            queryset = queryset.filter(status=PlantHealthEntry.STATUS_PUBLISHED)
        if self.request.query_params.get("kind"):
            queryset = queryset.filter(kind=self.request.query_params["kind"])
        query = normalize_text(self.request.query_params.get("q", "")[:200]) or ""
        for term in dict.fromkeys(query.split()):
            names = PlantHealthTranslation.objects.filter(
                entry_id=OuterRef("pk"),
                search_text__contains=term,
            )
            queryset = queryset.filter(
                Q(name_normalized__contains=term)
                | Q(scientific_name_normalized__contains=term)
                | Q(eppo_code__icontains=term)
                | Q(Exists(names)),
            )
        return queryset.distinct()

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entry = write_entry(None, serializer.validated_data, request.user)
        return Response(self.get_serializer(entry).data, status=status.HTTP_201_CREATED)

    def update(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        self._require_moderator(request)
        serializer = self.get_serializer(
            self.get_object(),
            data=request.data,
            partial=kwargs.get("partial", False),
        )
        serializer.is_valid(raise_exception=True)
        entry = write_entry(serializer.instance, serializer.validated_data, request.user)
        return Response(self.get_serializer(entry).data)

    @staticmethod
    def _require_moderator(request: Request) -> None:
        if not is_public_library_moderator(request.user):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Moderator privileges are required.")

    def _review(self, request: Request, review_action: str) -> Response:
        self._require_moderator(request)
        # Moderation may retrieve a pending proposal even without the list's status query.
        entry = get_object_or_404(PlantHealthEntry, pk=self.kwargs["pk"])
        serializer = self.get_serializer(entry, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        note = request.data.get("review_note", "")
        if not isinstance(note, str) or len(note) > 2000:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"review_note": "Use at most 2000 characters."})
        entry = write_entry(
            entry,
            serializer.validated_data,
            request.user,
            review_action=review_action,
            review_note=note.strip(),
        )
        return Response(self.get_serializer(entry).data)

    @action(detail=True, methods=["post"])
    def approve(self, request: Request, **kwargs: Any) -> Response:
        return self._review(request, "approve")

    @action(detail=True, methods=["post"])
    def reject(self, request: Request, **kwargs: Any) -> Response:
        return self._review(request, "reject")

    @action(detail=True, methods=["post"])
    def archive(self, request: Request, **kwargs: Any) -> Response:
        return self._review(request, "archive")

    @action(detail=True, methods=["post"])
    def reopen(self, request: Request, **kwargs: Any) -> Response:
        return self._review(request, "reopen")

    @action(detail=True, methods=["get"])
    def history(self, request: Request, **kwargs: Any) -> Response:
        self._require_moderator(request)
        entry = get_object_or_404(PlantHealthEntry, pk=self.kwargs["pk"])
        first_authors = list(
            entry.revisions.filter(actor__isnull=False)
            .values("actor_id")
            .annotate(first_revision=Min("pk"))
            .order_by("first_revision")
        )
        authors = (
            get_user_model()
            .objects.filter(pk__in=[row["actor_id"] for row in first_authors])
            .select_related("public_profile")
            .in_bulk()
        )
        anonymous_numbers = number_anonymous_authors(
            authors[row["actor_id"]] for row in first_authors if row["actor_id"] in authors
        )
        revisions = entry.revisions.select_related("actor__public_profile")[:100]
        return Response(
            PlantHealthRevisionSerializer(
                revisions,
                many=True,
                context={"anonymous_numbers": anonymous_numbers},
            ).data
        )


class PlantHealthHostViewSet(viewsets.ModelViewSet):
    serializer_class = PlantHealthHostSerializer
    permission_classes = [
        permissions.IsAuthenticated,
        CropLibraryTokenAccessPermission,
        CatalogueModeratorWritePermission,
    ]
    crop_library_token_actions = {"list", "retrieve", "create", "update", "partial_update"}
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self) -> QuerySet[PlantHealthHost]:
        queryset = PlantHealthHost.objects.select_related("entry", "species").prefetch_related(
            "species__translations",
        )
        if not is_public_library_moderator(self.request.user):
            queryset = queryset.filter(
                is_active=True, entry__status=PlantHealthEntry.STATUS_PUBLISHED
            )
        if self.request.query_params.get("entry"):
            queryset = queryset.filter(entry_id=self._query_id("entry"))
        if self.request.query_params.get("species"):
            queryset = queryset.filter(species_id=self._query_id("species"))
        return queryset

    def _query_id(self, field: str) -> int:
        from rest_framework import serializers

        return serializers.IntegerField(min_value=1).run_validation(
            self.request.query_params[field]
        )

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        host = write_host(None, serializer.validated_data, request.user)
        return Response(self.get_serializer(host).data, status=status.HTTP_201_CREATED)

    def update(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        serializer = self.get_serializer(
            self.get_object(),
            data=request.data,
            partial=kwargs.get("partial", False),
        )
        serializer.is_valid(raise_exception=True)
        host = write_host(serializer.instance, serializer.validated_data, request.user)
        return Response(self.get_serializer(host).data)

    @action(detail=True, methods=["post"])
    def archive(self, request: Request, **kwargs: Any) -> Response:
        PlantHealthEntryViewSet._require_moderator(request)
        host = write_host(self.get_object(), {}, request.user, archive=True)
        return Response(self.get_serializer(host).data)
