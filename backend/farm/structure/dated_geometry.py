"""The location, parcel and bed endpoints at the request's view date (#1634).

Reads show the measurements recorded for the selected season's view date
plus a ``geometry`` block, so List, Graphic and the detail pages agree.
Writes compare submitted measurements with that same dated version: unchanged
values never overwrite the present-row mirror; changes to an unused area
correct the viewed version directly; changes to a used area need the
preview/confirm workflow (``/api/growing-area-geometry/preview/``).
"""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from typing import Any

from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Model
from rest_framework import status
from rest_framework.exceptions import APIException

from farm.models import GrowingAreaGeometryVersion
from farm.project_context import resolve_season_id_from_request
from farm.services.geometry_changes import area_is_used, facts_as_dict
from farm.services.growing_area_geometry import (
    AreaKind,
    GeometryFacts,
    GeometryResolution,
    ResolvedGeometry,
    area_kind,
    correct_version,
    geometry_view_date,
    merge_facts,
    mirror_version,
    project_season,
    resolve_geometry,
)

GEOMETRY_CONTEXT_KEY = 'geometry_resolution'
_PARENT_FIELD: dict[AreaKind, str | None] = {'location': None, 'field': 'location', 'bed': 'field'}


class GeometryPreviewRequired(APIException):
    """A used area's measurements or parent change only through preview/confirm."""

    status_code = status.HTTP_409_CONFLICT
    default_code = 'geometry_preview_required'

    def __init__(self, payload: dict[str, Any]) -> None:
        super().__init__()
        # Keep numbers and dates as JSON values instead of DRF's error strings.
        self.detail = json.loads(json.dumps(payload, cls=DjangoJSONEncoder))


def request_view_date(request: Any) -> tuple[date, Any]:
    """The view date and season of a request, cached on the request."""
    cached = getattr(request, '_geometry_view', None)
    if cached is None:
        season = project_season(request.active_project, resolve_season_id_from_request(request))
        cached = (geometry_view_date(season), season)
        request._geometry_view = cached
    return cached


def resolve_for(request: Any, instances: list[Model]) -> GeometryResolution:
    """Resolve the given areas of one kind at the request's view date."""
    as_of, _season = request_view_date(request)
    if not instances:
        return GeometryResolution(as_of, {})
    return resolve_geometry(
        request.active_project, as_of, loaded=instances, with_ancestors=False,
    )


def _area_number(value: Decimal | None, kind: AreaKind) -> Any:
    if value is None:
        return None
    if kind == 'location':
        return float(round(value, 2))
    return str(value.quantize(Decimal('0.1')))


class DatedGeometrySerializerMixin:
    """Swap the present measurements for those recorded at the view date."""

    def to_representation(self, instance: Model) -> dict[str, Any]:
        data = super().to_representation(instance)
        request = self.context.get('request')
        if request is None or not hasattr(request, 'active_project'):
            return data
        resolution = self.context.get(GEOMETRY_CONTEXT_KEY)
        kind = area_kind(instance)
        entry = resolution.get(kind, instance.pk) if resolution else None
        if entry is None:
            entry = resolve_for(request, [instance]).get(kind, instance.pk)
        if entry is None:
            return data
        recorded = entry.version_id is not None
        if recorded:
            data['length_m'] = entry.length_m
            data['width_m'] = entry.width_m
            data['area_sqm'] = _area_number(entry.area_sqm, kind)
        data['geometry'] = _geometry_block(entry, request_view_date(request)[0], recorded)
        return data


def _geometry_block(entry: ResolvedGeometry, as_of: date, recorded: bool) -> dict[str, Any]:
    return {
        'as_of': as_of,
        'status': entry.status,
        'assignable': entry.assignable,
        'version_id': entry.version_id,
        'revision': entry.revision,
        'effective_from': entry.effective_from,
        'next_effective_from': entry.next_effective_from,
        'measurement_basis': entry.measurement_basis,
        'origin': entry.origin,
        # Present measurements shown for a date without recorded geometry.
        'reference': not recorded,
    }


_GEOMETRY_KEYS = ('length_m', 'width_m', 'area_sqm')


def _proposed_facts(
    kind: AreaKind, base: GeometryFacts, validated_data: dict[str, Any],
) -> GeometryFacts:
    values = {key: validated_data[key] for key in _GEOMETRY_KEYS if key in validated_data}
    parent_field = _PARENT_FIELD[kind]
    if parent_field and parent_field in validated_data:
        values['parent_id'] = validated_data[parent_field].pk
    return merge_facts(kind, base, values)


def _strip(kind: AreaKind, validated_data: dict[str, Any]) -> None:
    for key in (*_GEOMETRY_KEYS, _PARENT_FIELD[kind]):
        if key:
            validated_data.pop(key, None)


def guard_geometry_update(request: Any, instance: Model, validated_data: dict[str, Any]) -> None:
    """Route a structure PATCH/PUT through the dated geometry contract.

    Call it inside the update transaction, after locking ``instance``.
    """
    kind = area_kind(instance)
    as_of, season = request_view_date(request)
    versions = GrowingAreaGeometryVersion.objects.filter(**{f'{kind}_id': instance.pk})
    target = (
        versions.filter(effective_from__lte=as_of).order_by('-effective_from', '-pk').first()
        or mirror_version(kind, instance.pk)
    )
    base = GeometryFacts.from_version(target) if target else GeometryFacts.from_area(instance)
    proposed = _proposed_facts(kind, base, validated_data)
    if proposed == base:
        _strip(kind, validated_data)
        return
    if target is not None and target.state != GrowingAreaGeometryVersion.STATE_ACTIVE:
        raise GeometryPreviewRequired({
            'code': 'geometry_area_retired',
            'detail': 'A retired area keeps its last measurements.',
        })
    mirrored = mirror_version(kind, instance.pk)
    if not area_is_used(request.active_project, kind, instance.pk):
        if target is None or mirrored is None or target.pk == mirrored.pk:
            return  # the save corrects the mirrored version
        correct_version(target, proposed)
        _strip(kind, validated_data)
        return
    raise GeometryPreviewRequired({
        'code': 'geometry_preview_required',
        'detail': 'Changing the measurements of a used area needs a preview.',
        'kind': kind,
        'id': instance.pk,
        'name': instance.name,
        'version_id': target.pk if target else None,
        'revision': target.revision if target else None,
        'version_effective_from': target.effective_from if target else None,
        'season': season.pk if season else None,
        'season_start': season.start_date if season else None,
        'season_label': season.label if season else None,
        'previous': facts_as_dict(base),
        'proposed': facts_as_dict(proposed),
    })


class DatedGeometryViewMixin:
    """Resolve a whole page at once so lists stay at a constant query count."""

    def get_serializer(self, *args: Any, **kwargs: Any) -> Any:
        if kwargs.get('many') and args:
            instances = list(args[0])
            context = kwargs.pop('context', None) or self.get_serializer_context()
            context[GEOMETRY_CONTEXT_KEY] = resolve_for(self.request, instances)
            kwargs['context'] = context
            args = (instances, *args[1:])
        return super().get_serializer(*args, **kwargs)


def dated_context(view: Any, instances: list[Model]) -> dict[str, Any]:
    """Serializer context for an explicitly serialized group of areas."""
    resolution = resolve_for(view.request, instances)
    return {**view.get_serializer_context(), GEOMETRY_CONTEXT_KEY: resolution}


def guard_area_deletion(request: Any, instance: Model) -> None:
    """A used area is retired, never deleted; an unused one may still be removed."""
    kind = area_kind(instance)
    if not area_is_used(request.active_project, kind, instance.pk):
        return
    _as_of, season = request_view_date(request)
    versions = GrowingAreaGeometryVersion.objects.filter(**{f'{kind}_id': instance.pk})
    start = season.start_date if season else None
    target = (
        versions.filter(effective_from__lte=start).order_by('-effective_from', '-pk').first()
        if start else None
    ) or mirror_version(kind, instance.pk)
    raise GeometryPreviewRequired({
        'code': 'area_in_use',
        'detail': 'A used growing area can be retired from a season instead of deleted.',
        'kind': kind,
        'id': instance.pk,
        'name': instance.name,
        'version_id': target.pk if target else None,
        'revision': target.revision if target else None,
        'version_effective_from': target.effective_from if target else None,
        'season': season.pk if season else None,
        'season_start': start,
        'season_label': season.label if season else None,
    })
