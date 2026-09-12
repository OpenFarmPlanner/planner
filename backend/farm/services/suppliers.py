"""Supplier workflows: creation validation, delete-usage analysis, unlink/restore.

Business logic for the supplier endpoints; the viewset only parses requests,
wraps transactions/revision recording, and maps domain errors to responses.
"""

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from django.db import IntegrityError, transaction

from farm.models import Crop, CropSupplierData, Supplier
from farm.utils import normalize_supplier_name

SUPPLIER_NAME_REQUIRED_MESSAGE = 'Dieses Feld ist erforderlich.'
SUPPLIER_HOMEPAGE_INVALID_MESSAGE = 'Bitte geben Sie eine gültige URL ein.'
SUPPLIER_DOMAINS_LIST_MESSAGE = 'Bitte geben Sie eine Liste von Domains an.'
SUPPLIER_DOMAINS_INVALID_MESSAGE = 'Domains müssen gültige Hostnamen ohne Schema oder Pfad sein.'
SUPPLIER_NAME_DUPLICATE_MESSAGE = 'Ein Lieferant mit diesem Namen existiert bereits.'


class SupplierPayloadError(Exception):
    """A supplier payload failed field validation; `errors` maps field -> messages."""

    def __init__(self, errors: dict[str, list[str]]):
        super().__init__(str(errors))
        self.errors = errors


class DuplicateSupplierNameError(Exception):
    """A supplier with the same normalized name already exists in the project."""


class SupplierRestoreConflictError(Exception):
    """The supplier id from the undo payload is already in use."""


class SupplierRestoreFailedError(Exception):
    """The restore transaction failed (integrity or value error)."""


def build_delete_usage(supplier: Supplier) -> dict[str, int | bool | list[int]]:
    """Summarize which crops/rows still reference the supplier."""
    supplier_crop_ids = set(
        Crop.objects.filter(
            project=supplier.project,
            deleted_at__isnull=True,
            supplier=supplier,
        ).values_list('id', flat=True)
    )
    seed_demand_crop_ids = set(
        Crop.objects.filter(
            project=supplier.project,
            deleted_at__isnull=True,
            selected_seed_demand_supplier=supplier,
        ).values_list('id', flat=True)
    )
    supplier_data_crop_ids = set(
        CropSupplierData.objects.filter(
            project=supplier.project,
            supplier=supplier,
            crop__deleted_at__isnull=True,
        ).values_list('crop_id', flat=True)
    )
    supplier_data_rows = CropSupplierData.objects.filter(
        project=supplier.project,
        supplier=supplier,
        crop__deleted_at__isnull=True,
    ).count()
    total_crop_ids = supplier_crop_ids | seed_demand_crop_ids | supplier_data_crop_ids

    return {
        'can_delete': len(total_crop_ids) == 0 and supplier_data_rows == 0,
        'crop_count': len(supplier_crop_ids),
        'seed_demand_crop_count': len(seed_demand_crop_ids),
        'supplier_data_crop_count': len(supplier_data_crop_ids),
        'supplier_data_count': supplier_data_rows,
        'total_crop_count': len(total_crop_ids),
        'crop_ids': sorted(total_crop_ids),
    }


def build_delete_undo_payload(supplier: Supplier) -> dict[str, object]:
    """Capture everything needed to undo an unlink-and-delete of the supplier."""
    supplier_crops = list(
        Crop.all_objects.filter(project=supplier.project, supplier=supplier).values_list('id', flat=True)
    )
    seed_demand_crops = list(
        Crop.all_objects.filter(
            project=supplier.project,
            selected_seed_demand_supplier=supplier,
        ).values_list('id', flat=True)
    )
    supplier_data_rows = []
    for row in CropSupplierData.objects.filter(project=supplier.project, supplier=supplier):
        supplier_data_rows.append({
            'id': row.id,
            'crop_id': row.crop_id,
            'supplier_name': row.supplier_name,
            'supplier_url': row.supplier_url,
            'supplier_product_name': row.supplier_product_name,
            'supplier_product_url': row.supplier_product_url,
            'packaging_sizes': row.packaging_sizes,
            'thousand_kernel_weight_g': (
                str(row.thousand_kernel_weight_g)
                if row.thousand_kernel_weight_g is not None
                else None
            ),
            'germination_rate': row.germination_rate,
            'price': str(row.price) if row.price is not None else None,
            'notes': row.notes,
            'source_url': row.source_url,
        })

    return {
        'supplier': {
            'id': supplier.id,
            'name': supplier.name,
            'homepage_url': supplier.homepage_url,
            'slug': supplier.slug,
            'allowed_domains': supplier.allowed_domains,
        },
        'crop_ids': supplier_crops,
        'seed_demand_crop_ids': seed_demand_crops,
        'supplier_data': supplier_data_rows,
    }


def unlink_supplier_references(supplier: Supplier) -> None:
    """Detach all crop references to the supplier and drop its data rows."""
    Crop.all_objects.filter(project=supplier.project, supplier=supplier).update(supplier=None)
    Crop.all_objects.filter(
        project=supplier.project,
        selected_seed_demand_supplier=supplier,
    ).update(selected_seed_demand_supplier=None)
    CropSupplierData.objects.filter(project=supplier.project, supplier=supplier).delete()


@dataclass
class SupplierRestoreResult:
    supplier: Supplier
    restored_crop_count: int
    restored_supplier_data_count: int


def restore_unlinked_supplier(
    *,
    project,
    payload: dict,
    record_restore: Callable[[Supplier], None],
) -> SupplierRestoreResult:
    """Recreate a supplier (with its original id) from an unlink-and-delete undo payload.

    `record_restore` is invoked inside the restore transaction so a failing
    revision write rolls the whole restore back, matching the previous inline
    behavior.
    """
    supplier_payload = payload.get('supplier')
    if not isinstance(supplier_payload, dict):
        raise SupplierPayloadError({'supplier': ['Supplier restore data is required.']})

    supplier_id = supplier_payload.get('id')
    if not isinstance(supplier_id, int):
        raise SupplierPayloadError({'supplier': ['Supplier id is required.']})
    if Supplier.objects.filter(project=project, pk=supplier_id).exists():
        raise SupplierRestoreConflictError()

    crop_ids = [item for item in payload.get('crop_ids', []) if isinstance(item, int)]
    seed_demand_crop_ids = [
        item for item in payload.get('seed_demand_crop_ids', []) if isinstance(item, int)
    ]
    supplier_data_rows = payload.get('supplier_data', [])
    if not isinstance(supplier_data_rows, list):
        supplier_data_rows = []

    try:
        with transaction.atomic():
            supplier = Supplier.objects.create(
                id=supplier_id,
                project=project,
                name=str(supplier_payload.get('name') or ''),
                homepage_url=str(supplier_payload.get('homepage_url') or ''),
                slug=str(supplier_payload.get('slug') or ''),
                allowed_domains=supplier_payload.get('allowed_domains') or [],
            )
            Crop.all_objects.filter(project=project, id__in=crop_ids).update(supplier=supplier)
            Crop.all_objects.filter(
                project=project,
                id__in=seed_demand_crop_ids,
            ).update(selected_seed_demand_supplier=supplier)

            restored_supplier_data_count = 0
            for row_payload in supplier_data_rows:
                if _restore_supplier_data_row(project, supplier, row_payload):
                    restored_supplier_data_count += 1

            record_restore(supplier)
    except (IntegrityError, ValueError) as exc:
        raise SupplierRestoreFailedError() from exc

    return SupplierRestoreResult(
        supplier=supplier,
        restored_crop_count=len(set(crop_ids) | set(seed_demand_crop_ids)),
        restored_supplier_data_count=restored_supplier_data_count,
    )


def _restore_supplier_data_row(project, supplier: Supplier, row_payload: object) -> bool:
    """Recreate one CropSupplierData row from the undo payload; skip invalid rows."""
    if not isinstance(row_payload, dict):
        return False
    crop_id = row_payload.get('crop_id')
    if not isinstance(crop_id, int):
        return False
    if not Crop.all_objects.filter(project=project, pk=crop_id).exists():
        return False
    CropSupplierData.objects.create(
        id=row_payload.get('id') if isinstance(row_payload.get('id'), int) else None,
        crop_id=crop_id,
        supplier=supplier,
        project=project,
        supplier_name=str(row_payload.get('supplier_name') or ''),
        supplier_url=str(row_payload.get('supplier_url') or ''),
        supplier_product_name=str(row_payload.get('supplier_product_name') or ''),
        supplier_product_url=str(row_payload.get('supplier_product_url') or ''),
        packaging_sizes=row_payload.get('packaging_sizes') or [],
        thousand_kernel_weight_g=(
            Decimal(str(row_payload['thousand_kernel_weight_g']))
            if row_payload.get('thousand_kernel_weight_g') is not None
            else None
        ),
        germination_rate=row_payload.get('germination_rate'),
        price=(
            Decimal(str(row_payload['price']))
            if row_payload.get('price') is not None
            else None
        ),
        notes=str(row_payload.get('notes') or ''),
        source_url=str(row_payload.get('source_url') or ''),
    )
    return True


def normalize_new_supplier_payload(
    *,
    name: object,
    homepage_url: object,
    allowed_domains: object,
) -> dict[str, object]:
    """Validate and normalize the create-supplier fields.

    Returns the normalized field dict; raises SupplierPayloadError with the
    exact field -> message mapping the endpoint has always returned.
    """
    name = (name or '').strip()
    homepage_url = (homepage_url or '').strip()

    if not name:
        raise SupplierPayloadError({'name': [SUPPLIER_NAME_REQUIRED_MESSAGE]})

    # Normalize homepage_url (prepend https:// if no protocol)
    if homepage_url and not homepage_url.startswith(('http://', 'https://')):
        homepage_url = f'https://{homepage_url}'

    url_validator = URLValidator()
    try:
        if homepage_url:
            url_validator(homepage_url)
    except DjangoValidationError:
        raise SupplierPayloadError({'homepage_url': [SUPPLIER_HOMEPAGE_INVALID_MESSAGE]}) from None

    if allowed_domains and not isinstance(allowed_domains, list):
        raise SupplierPayloadError({'allowed_domains': [SUPPLIER_DOMAINS_LIST_MESSAGE]})
    if allowed_domains:
        normalized_domains = Supplier.normalize_allowed_domains(allowed_domains)
        invalid = [domain for domain in normalized_domains if not Supplier._is_valid_domain(Supplier._normalize_domain(domain))]
        if invalid:
            raise SupplierPayloadError({
                'allowed_domains': [
                    f'Ungültige Domain(s): {", ".join(invalid)}. {SUPPLIER_DOMAINS_INVALID_MESSAGE}'
                ],
            })

    return {
        'name': name,
        'homepage_url': homepage_url,
        'allowed_domains': Supplier.normalize_allowed_domains(allowed_domains) if isinstance(allowed_domains, list) else [],
    }


def create_supplier(*, project, name: str, homepage_url: str, allowed_domains: list) -> Supplier:
    """Create a supplier, rejecting normalized duplicate names within the project."""
    normalized = normalize_supplier_name(name) or ''

    # Check normalized duplicates before relying on the database constraint.
    if Supplier.objects.filter(project=project, name_normalized=normalized).exists():
        raise DuplicateSupplierNameError()

    try:
        with transaction.atomic():
            return Supplier.objects.create(
                name=name,
                homepage_url=homepage_url,
                allowed_domains=allowed_domains,
                project=project,
            )
    except IntegrityError as exc:
        if Supplier.objects.filter(project=project, name_normalized=normalized).exists():
            raise DuplicateSupplierNameError() from exc
        raise
