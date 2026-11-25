"""Persisted parcel and bed ordering used for consecutive season copies."""

from dataclasses import dataclass

from django.db.models import QuerySet

from farm.models import Bed, ParcelRotationGroup, ParcelRotationMember, Project


@dataclass(frozen=True)
class OrderedParcel:
    member: ParcelRotationMember
    beds: tuple[Bed, ...]


@dataclass(frozen=True)
class RotationGroup:
    group: ParcelRotationGroup
    parcels: tuple[OrderedParcel, ...]

    @property
    def has_equal_bed_counts(self) -> bool:
        return len({len(parcel.beds) for parcel in self.parcels}) <= 1


def rotation_group_queryset(project: Project) -> QuerySet[ParcelRotationGroup]:
    return ParcelRotationGroup.objects.filter(project=project).prefetch_related(
        'members__field__beds',
    )


def ordered_group(group: ParcelRotationGroup) -> RotationGroup:
    parcels = []
    for member in group.members.all():
        available = {bed.pk: bed for bed in member.field.beds.all()}
        # Keep configured positions when the same beds still exist. New beds
        # join after them, and disappeared IDs no longer take up a position.
        beds = [available.pop(bed_id) for bed_id in member.bed_order if bed_id in available]
        beds.extend(available[bed_id] for bed_id in sorted(available))
        parcels.append(OrderedParcel(member=member, beds=tuple(beds)))
    return RotationGroup(group=group, parcels=tuple(parcels))


def describe_rotation_group(ordered: RotationGroup) -> dict:
    return {
        'id': ordered.group.pk,
        'name': ordered.group.name,
        'valid': ordered.has_equal_bed_counts,
        'parcels': [
            {
                'id': parcel.member.field_id,
                'name': parcel.member.field.name,
                'beds': [{'id': bed.pk, 'name': bed.name} for bed in parcel.beds],
            }
            for parcel in ordered.parcels
        ],
    }
