"""Project-scoped configuration for ordered parcel rotation groups."""

from django.db import transaction
from django.db.models import F
from rest_framework import serializers, status, viewsets
from rest_framework.response import Response

from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.history import _current_actor_label, _serialize_instance
from farm.history.project_restore import ensure_project_checkpoint
from farm.history.records import internal_project_versions
from farm.models import EntityRevision, Field, ParcelRotationGroup, ParcelRotationMember
from farm.services.crop_inheritance import lock_crop_project
from farm.services.parcel_rotation import (
    describe_rotation_group,
    ordered_group,
    rotation_group_queryset,
)


class RotationParcelSerializer(serializers.Serializer):
    id = serializers.IntegerField(min_value=1)
    bed_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False)


class ParcelRotationGroupSerializer(serializers.ModelSerializer):
    parcels = RotationParcelSerializer(many=True, allow_empty=False)

    class Meta:
        model = ParcelRotationGroup
        fields = ['id', 'name', 'parcels']

    def to_representation(self, instance):
        return describe_rotation_group(ordered_group(instance))

    def validate(self, attrs):
        project = self.context['request'].active_project
        existing = self.instance
        name = attrs.get('name') if 'name' in attrs else existing.name
        if (
            ParcelRotationGroup.objects.filter(project=project, name=name)
            .exclude(pk=getattr(existing, 'pk', None))
            .exists()
        ):
            raise serializers.ValidationError({'name': 'A rotation group already uses this name.'})
        if 'parcels' not in attrs:
            attrs['parcels'] = [
                {'id': parcel.member.field_id, 'bed_ids': [bed.pk for bed in parcel.beds]}
                for parcel in ordered_group(existing).parcels
            ]
        attrs['parcels'] = self._validate_parcels(attrs['parcels'], project, existing)
        return attrs

    @staticmethod
    def _validate_parcels(parcels, project, existing):
        ids = [parcel['id'] for parcel in parcels]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError({'parcels': 'Each parcel can appear only once.'})
        fields = (
            Field.objects.filter(project=project, pk__in=ids).prefetch_related('beds').in_bulk()
        )
        if len(fields) != len(ids):
            raise serializers.ValidationError({'parcels': 'Choose parcels in this project.'})
        if ParcelRotationMember.objects.filter(field_id__in=ids).exclude(group=existing).exists():
            raise serializers.ValidationError(
                {'parcels': 'A parcel already belongs to another group.'}
            )

        bed_counts = set()
        for entry in parcels:
            field = fields[entry['id']]
            default_order = [bed.pk for bed in field.beds.all()]
            order = entry.setdefault('bed_ids', default_order)
            if len(order) != len(default_order) or set(order) != set(default_order):
                raise serializers.ValidationError(
                    {'parcels': 'The bed order must include every bed once.'}
                )
            bed_counts.add(len(order))
        if len(bed_counts) > 1:
            raise serializers.ValidationError(
                {'parcels': 'All parcels must have the same number of beds.'}
            )
        return parcels


class ParcelRotationGroupViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    serializer_class = ParcelRotationGroupSerializer
    history_read_only = True
    pagination_class = None

    def get_queryset(self):
        return rotation_group_queryset(self.request.active_project)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        return self._save_configuration(request)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return self._save_configuration(
            request, updating=True, partial=kwargs.get('partial', False)
        )

    def _save_configuration(self, request, *, updating=False, partial=False):
        project = request.active_project
        lock_crop_project(project.pk)
        group = self.get_object() if updating else None
        serializer = self.get_serializer(group, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        ensure_project_checkpoint(project, user_name=_current_actor_label(request))
        name = serializer.validated_data.get('name')
        previous = _serialize_instance(group) if group else None
        if group is None:
            group = ParcelRotationGroup.objects.create(project=project, name=name)
        elif name is not None and name != group.name:
            group.name = name
            group.save(update_fields=['name', 'updated_at'])
        self._save_members(group, serializer.validated_data['parcels'])
        self.record_revision(
            group,
            EntityRevision.ACTION_UPDATED if updating else EntityRevision.ACTION_CREATED,
            previous_snapshot=previous,
        )
        refreshed = self.get_queryset().get(pk=group.pk)
        return Response(
            self.get_serializer(refreshed).data,
            status=status.HTTP_200_OK if updating else status.HTTP_201_CREATED,
        )

    def _save_members(self, group, parcels):
        existing = {member.field_id: member for member in group.members.all()}
        included = {parcel['id'] for parcel in parcels}
        # Move old positions aside before a swap to obey the unique constraint.
        offset = max([len(parcels), *(member.position for member in existing.values())])
        group.members.update(position=F('position') + offset)
        with internal_project_versions():
            for member in existing.values():
                if member.field_id not in included:
                    self.perform_destroy(member)
            for position, entry in enumerate(parcels, start=1):
                self._save_member(group, existing.get(entry['id']), entry, position)

    def _save_member(self, group, member, entry, position):
        if member is None:
            member = group.members.create(
                project=group.project,
                field_id=entry['id'],
                position=position,
                bed_order=entry['bed_ids'],
            )
            self.record_revision(member, EntityRevision.ACTION_CREATED)
            return
        previous = _serialize_instance(member)
        member.position = position
        member.bed_order = entry['bed_ids']
        member.save(update_fields=['position', 'bed_order', 'updated_at'])
        self.record_revision(member, EntityRevision.ACTION_UPDATED, previous_snapshot=previous)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        project = request.active_project
        lock_crop_project(project.pk)
        group = self.get_object()
        ensure_project_checkpoint(project, user_name=_current_actor_label(request))
        self.perform_destroy(group)
        return Response(status=status.HTTP_204_NO_CONTENT)
