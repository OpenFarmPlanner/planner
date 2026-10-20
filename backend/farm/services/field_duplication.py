"""Duplicate a field ("Parzelle duplizieren") with its beds in one transaction.

Only the structure is copied: the field's location and dimensions and, on
request, each bed's name and dimensions. Notes, layouts, planting plans and
everything hanging off them stay with the source.
"""

from collections.abc import Callable
from dataclasses import dataclass

from django.db import IntegrityError, transaction

from farm.models import Bed, Field


class FieldNameTakenError(Exception):
    """The new field name is already used in the source field's location."""


class BedNameConflictError(Exception):
    """The renamed beds would share a name inside the new field."""

    def __init__(self, names: list[str]) -> None:
        super().__init__(', '.join(names))
        self.names = names


class InvalidBedNameError(Exception):
    """A renamed bed would be empty or longer than a bed name may be."""

    def __init__(self, names: list[str]) -> None:
        super().__init__(', '.join(names))
        self.names = names


@dataclass(frozen=True)
class FieldDuplicate:
    field: Field
    beds: list[Bed]


def replace_first(name: str, search: str, replacement: str) -> str:
    """Replace the first case-sensitive occurrence of `search`; an empty search keeps the name."""
    if not search:
        return name
    return name.replace(search, replacement, 1)


def duplicate_bed_names(names: list[str]) -> list[str]:
    """Names that occur more than once, sorted, each listed once."""
    seen: set[str] = set()
    duplicates: set[str] = set()
    for name in names:
        if name in seen:
            duplicates.add(name)
        seen.add(name)
    return sorted(duplicates)


def duplicate_field(
    source: Field,
    *,
    name: str,
    copy_beds: bool,
    search: str = '',
    replacement: str = '',
    on_created: Callable[[Field | Bed], None] | None = None,
) -> FieldDuplicate:
    """Create a copy of `source` named `name`, optionally with renamed copies of its beds.

    All-or-nothing: a conflict raises before or rolls back every write.
    `on_created` is called for each created row inside the transaction
    (the view records its `created` revision there).
    """
    if Field.objects.filter(location_id=source.location_id, name=name).exists():
        raise FieldNameTakenError(name)

    source_beds = list(source.beds.order_by('name', 'pk')) if copy_beds else []
    bed_names = [replace_first(bed.name, search, replacement).strip() for bed in source_beds]
    max_length = Bed._meta.get_field('name').max_length
    invalid = [
        bed.name for bed, bed_name in zip(source_beds, bed_names, strict=True)
        if not bed_name or len(bed_name) > max_length
    ]
    if invalid:
        raise InvalidBedNameError(invalid)
    conflicts = duplicate_bed_names(bed_names)
    if conflicts:
        raise BedNameConflictError(conflicts)

    with transaction.atomic():
        try:
            with transaction.atomic():
                new_field = Field.objects.create(
                    project_id=source.project_id,
                    location_id=source.location_id,
                    name=name,
                    length_m=source.length_m,
                    width_m=source.width_m,
                    # Recomputed by Field.save() whenever both dimensions are set.
                    area_sqm=source.area_sqm,
                )
        except IntegrityError as exc:
            # A concurrent create took the name between the check and the insert.
            raise FieldNameTakenError(name) from exc
        if on_created:
            on_created(new_field)
        new_beds: list[Bed] = []
        for bed, bed_name in zip(source_beds, bed_names, strict=True):
            new_bed = Bed.objects.create(
                project_id=source.project_id,
                field=new_field,
                name=bed_name,
                length_m=bed.length_m,
                width_m=bed.width_m,
                area_sqm=bed.area_sqm,
            )
            if on_created:
                on_created(new_bed)
            new_beds.append(new_bed)
    return FieldDuplicate(field=new_field, beds=new_beds)
