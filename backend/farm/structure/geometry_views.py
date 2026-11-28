"""Season/date-aware geometry reads for List, Graphic and Map (#1634).

These endpoints only read. The present measurement fields on the location,
parcel and bed endpoints stay compatible while consumers migrate. They are
not on the API-token allowlist: publishing them to agents is a separate,
deliberate surface decision (farm/agent_api/schema.py).
"""

import json
import math
from datetime import date
from decimal import Decimal
from typing import Any

from django.core.serializers.json import DjangoJSONEncoder
from rest_framework import serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.pagination import OpenFarmPlannerPageNumberPagination
from config.responses import api_error_response
from farm.history import _current_actor_label
from farm.history.project_restore import ensure_project_checkpoint
from farm.models import Bed, Field, GrowingAreaGeometryVersion
from farm.project_context import get_active_project_or_400, resolve_season_id_from_request
from farm.services.geometry_changes import (
    ACTION_CORRECTION,
    ACTION_PHYSICAL_CHANGE,
    ACTION_RETIREMENT,
    ACTIONS,
    GeometryChangeConflict,
    GeometryChangeRequest,
    confirm_geometry_change,
    preview_geometry_change,
    proposed_base,
)
from farm.services.growing_area_geometry import (
    AREA_KINDS,
    AREA_MODELS,
    STATUS_UNKNOWN,
    AreaKind,
    GeometryFacts,
    area_timeline,
    geometry_view_date,
    merge_facts,
    project_season,
    resolve_geometry,
)
from farm.structure.serializers import MAX_LOCATION_DIMENSION_M

MAX_REQUESTED_IDS = 1000
MAX_TIMELINE_VERSIONS = 500


class _BadRequest(Exception):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _parse_kind(raw: str | None, *, required: bool) -> AreaKind | None:
    if raw in (None, ''):
        if required:
            raise _BadRequest('invalid_geometry_kind', 'kind must be location, field or bed.')
        return None
    if raw not in AREA_KINDS:
        raise _BadRequest('invalid_geometry_kind', 'kind must be location, field or bed.')
    return raw


def _parse_ids(raw: str | None) -> list[int] | None:
    if raw in (None, ''):
        return None
    try:
        ids = [int(part) for part in raw.split(',') if part.strip()]
    except ValueError as exc:
        raise _BadRequest('invalid_geometry_ids', 'ids must be comma-separated integers.') from exc
    if not ids or len(ids) > MAX_REQUESTED_IDS:
        raise _BadRequest(
            'invalid_geometry_ids', f'Between 1 and {MAX_REQUESTED_IDS} ids are allowed.',
        )
    return ids


def _view_date(request: Request, project) -> tuple[date, int | None]:
    raw_date = request.query_params.get('date')
    raw_season = request.query_params.get('season')
    if raw_date:
        try:
            return date.fromisoformat(raw_date), None
        except ValueError as exc:
            raise _BadRequest('invalid_geometry_date', 'date must be YYYY-MM-DD.') from exc
    season_id = None
    if raw_season:
        try:
            season_id = int(raw_season)
        except ValueError as exc:
            raise _BadRequest('invalid_geometry_season', 'season must be an id.') from exc
        season = project_season(project, season_id)
        if season is None:
            raise _BadRequest('invalid_geometry_season', 'The season does not exist.')
        return geometry_view_date(season), season.pk
    season = project_season(project, resolve_season_id_from_request(request))
    return geometry_view_date(season), season.pk if season else None


def _area_keys(project, kind: AreaKind | None, ids: list[int] | None) -> list[tuple[AreaKind, int]]:
    kinds = (kind,) if kind else AREA_KINDS
    keys: list[tuple[AreaKind, int]] = []
    for area_kind in kinds:
        queryset = AREA_MODELS[area_kind].objects.filter(project=project)
        if ids is not None:
            queryset = queryset.filter(pk__in=ids)
        keys.extend((area_kind, pk) for pk in queryset.order_by('pk').values_list('pk', flat=True))
    return keys


def _current_references(project, keys: list[tuple[AreaKind, int]]) -> dict[tuple[str, int], dict]:
    """Present measurements of unknown entries, labeled and never used for calculations."""
    references: dict[tuple[str, int], dict] = {}
    for kind in AREA_KINDS:
        ids = [area_id for entry_kind, area_id in keys if entry_kind == kind]
        if not ids:
            continue
        for row in AREA_MODELS[kind].objects.filter(project=project, pk__in=ids):
            facts = GeometryFacts.from_area(row)
            references[(kind, row.pk)] = {
                'length_m': facts.length_m,
                'width_m': facts.width_m,
                'area_sqm': float(facts.area_sqm) if facts.area_sqm is not None else None,
                'measurement_basis': facts.basis,
            }
    return references


class GrowingAreaGeometryView(APIView):
    """GET the dated geometry of the project's areas, paginated.

    Query: ``date`` (YYYY-MM-DD) or ``season`` (id); without either the
    ``X-Season-Id`` season's view date or today. Optional ``kind`` and
    ``ids`` narrow the areas; ``include_reference=true`` adds the present
    measurements of unknown entries as a labeled display reference.
    """

    def get(self, request: Request) -> Response:
        project = get_active_project_or_400(request)
        try:
            as_of, season_id = _view_date(request, project)
            kind = _parse_kind(request.query_params.get('kind'), required=False)
            ids = _parse_ids(request.query_params.get('ids'))
            if ids is not None and kind is None:
                raise _BadRequest('invalid_geometry_kind', 'ids require a kind.')
        except _BadRequest as error:
            return api_error_response(
                code=error.code, detail=error.detail, status_code=status.HTTP_400_BAD_REQUEST,
            )
        paginator = OpenFarmPlannerPageNumberPagination()
        page = paginator.paginate_queryset(_area_keys(project, kind, ids), request, view=self)
        page_ids = {
            f'{area_kind}s': [area_id for entry_kind, area_id in page if entry_kind == area_kind]
            for area_kind in AREA_KINDS
        }
        resolution = resolve_geometry(project, as_of, **page_ids)
        entries = [resolution.get(area_kind, area_id) for area_kind, area_id in page]
        results: list[dict[str, Any]] = [entry.as_dict() for entry in entries if entry]
        if request.query_params.get('include_reference') == 'true':
            unknown = [(entry.kind, entry.area_id) for entry in entries
                       if entry and entry.status == STATUS_UNKNOWN]
            references = _current_references(project, unknown)
            for result in results:
                result['reference'] = references.get((result['kind'], result['id']))
        response = paginator.get_paginated_response(results)
        response.data['as_of'] = as_of
        response.data['season'] = season_id
        return response


def _serialize_version(version: GrowingAreaGeometryVersion) -> dict[str, Any]:
    season = version.original_season
    return {
        'id': version.pk,
        'effective_from': version.effective_from,
        'state': version.state,
        'origin': version.origin,
        'parent_id': version.parent_id,
        'length_m': version.length_m,
        'width_m': version.width_m,
        'area_sqm': (
            float(version.confirmed_area_sqm) if version.confirmed_area_sqm is not None else None
        ),
        'measurement_basis': version.measurement_basis,
        'original_season': {'id': season.pk, 'label': season.label} if season else None,
        'revision': version.revision,
        'created_at': version.created_at,
        'updated_at': version.updated_at,
    }


class GrowingAreaGeometryTimelineView(APIView):
    """GET one area's version timeline: ``?kind=bed&id=42``."""

    def get(self, request: Request) -> Response:
        project = get_active_project_or_400(request)
        try:
            kind = _parse_kind(request.query_params.get('kind'), required=True)
            area_id = int(request.query_params.get('id', ''))
        except _BadRequest as error:
            return api_error_response(
                code=error.code, detail=error.detail, status_code=status.HTTP_400_BAD_REQUEST,
            )
        except ValueError:
            return api_error_response(
                code='invalid_geometry_ids', detail='id must be an integer.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if not AREA_MODELS[kind].objects.filter(project=project, pk=area_id).exists():
            return api_error_response(
                code='not_found', detail='The area does not exist.',
                status_code=status.HTTP_404_NOT_FOUND,
            )
        versions = area_timeline(project, kind, area_id, limit=MAX_TIMELINE_VERSIONS + 1)
        return Response({
            'kind': kind,
            'id': area_id,
            'versions': [
                _serialize_version(version) for version in versions[:MAX_TIMELINE_VERSIONS]
            ],
            'truncated': len(versions) > MAX_TIMELINE_VERSIONS,
        })


_AREA_LIMITS = {'field': (Field.MIN_AREA_SQM, Field.MAX_AREA_SQM),
                'bed': (Bed.MIN_AREA_SQM, Bed.MAX_AREA_SQM)}


def validate_measurements(kind: str, attrs: dict[str, Any]) -> None:
    """The same positive, finite and bounded values the area forms accept."""
    errors: dict[str, str] = {}
    for name in ('length_m', 'width_m'):
        value = attrs.get(name)
        if value is None:
            continue
        if not math.isfinite(value) or value <= 0:
            errors[name] = 'Must be a finite number greater than 0.'
        elif kind == 'location' and value > MAX_LOCATION_DIMENSION_M:
            errors[name] = f'Must not exceed {MAX_LOCATION_DIMENSION_M:g} m.'
    if kind == 'location' and attrs.get('area_sqm') is not None:
        errors['area_sqm'] = 'A location area follows from its dimensions.'
    limits = _AREA_LIMITS.get(kind)
    length, width = attrs.get('length_m'), attrs.get('width_m')
    area = attrs.get('area_sqm')
    if limits and not errors and length and width:
        area = Decimal(str(length * width)).quantize(Decimal('0.1'))
    if limits and area is not None and not limits[0] <= area <= limits[1]:
        errors['area_sqm'] = f'Area must be between {limits[0]} and {limits[1]} sqm.'
    if errors:
        raise serializers.ValidationError(errors)


class GeometryChangeSerializer(serializers.Serializer):
    """Input of a geometry change preview; limits match the area serializers."""

    kind = serializers.ChoiceField(choices=AREA_KINDS)
    id = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=ACTIONS)
    season = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    version_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    revision = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    length_m = serializers.FloatField(required=False, allow_null=True)
    width_m = serializers.FloatField(required=False, allow_null=True)
    area_sqm = serializers.DecimalField(
        max_digits=10, decimal_places=1, required=False, allow_null=True,
    )
    parent_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        attrs = super().validate(attrs)
        if attrs['action'] == ACTION_CORRECTION and not attrs.get('version_id'):
            raise serializers.ValidationError({'version_id': 'A correction names its version.'})
        dated = attrs['action'] in (ACTION_PHYSICAL_CHANGE, ACTION_RETIREMENT)
        if dated and not attrs.get('season'):
            raise serializers.ValidationError({'season': 'This change needs a season.'})
        validate_measurements(attrs['kind'], attrs)
        return attrs


def change_request(project, data: dict[str, Any]) -> GeometryChangeRequest:
    """Build a change request; unspecified facts keep the target version's values."""
    season = None
    if data.get('season'):
        season = project_season(project, data['season'])
        if season is None:
            raise GeometryChangeConflict('invalid_geometry_season', 'The season does not exist.')
    kind = data['kind']
    current = proposed_base(project, kind, data['id'], data.get('version_id'), season)
    values = {
        key: data[key] for key in ('length_m', 'width_m', 'area_sqm', 'parent_id') if key in data
    }
    return GeometryChangeRequest(
        kind=kind, area_id=data['id'], action=data['action'], season=season,
        version_id=data.get('version_id'), revision=data.get('revision'),
        facts=merge_facts(kind, current, values),
    )


def _conflict_response(error: GeometryChangeConflict) -> Response:
    status_code = (
        status.HTTP_404_NOT_FOUND if error.code == 'not_found' else status.HTTP_409_CONFLICT
    )
    return api_error_response(
        code=error.code, detail=error.detail, status_code=status_code,
        **json.loads(json.dumps(error.context, cls=DjangoJSONEncoder)),
    )


class GrowingAreaGeometryPreviewView(APIView):
    """POST a proposed correction or physical change; nothing is written."""

    def post(self, request: Request) -> Response:
        project = get_active_project_or_400(request)
        serializer = GeometryChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            preview = preview_geometry_change(
                project, change_request(project, serializer.validated_data),
                user_id=request.user.pk,
            )
        except GeometryChangeConflict as error:
            return _conflict_response(error)
        return Response(preview)


class GeometryConfirmSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=4096)
    request_id = serializers.UUIDField()


class GrowingAreaGeometryConfirmView(APIView):
    """POST a preview token and request ID to apply exactly the previewed change."""

    def post(self, request: Request) -> Response:
        project = get_active_project_or_400(request)
        serializer = GeometryConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ensure_project_checkpoint(project, user_name=_current_actor_label(request))
        try:
            result = confirm_geometry_change(
                project, serializer.validated_data['token'],
                serializer.validated_data['request_id'],
                user_id=request.user.pk, actor_label=_current_actor_label(request),
            )
        except GeometryChangeConflict as error:
            return _conflict_response(error)
        return Response(result)
