"""Serializers for suppliers and per-crop supplier data rows."""


from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from rest_framework import serializers

from farm.common.serializer_fields import (
    _resolve_active_project_from_serializer,
)
from farm.models import (
    CropSupplierData,
    Supplier,
)
from farm.services.suppliers import (
    SUPPLIER_DOMAINS_INVALID_MESSAGE,
    SUPPLIER_DOMAINS_LIST_MESSAGE,
    SUPPLIER_HOMEPAGE_INVALID_MESSAGE,
    SUPPLIER_NAME_DUPLICATE_MESSAGE,
    SUPPLIER_NAME_REQUIRED_MESSAGE,
)


class SupplierSerializer(serializers.ModelSerializer):
    created = serializers.BooleanField(read_only=True, default=False)
    homepage_url = serializers.CharField(required=False, allow_blank=True, max_length=200)

    def get_image_file(self, obj):
        if not obj.image_file_id:
            return None
        return {
            'id': obj.image_file_id,
            'storage_path': obj.image_file.storage_path,
        }

    def validate_allowed_domains(self, value):
        if value is None:
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError(SUPPLIER_DOMAINS_LIST_MESSAGE)
        normalized = Supplier.normalize_allowed_domains(value)
        invalid = [domain for domain in normalized if not Supplier._is_valid_domain(Supplier._normalize_domain(domain))]
        if invalid:
            raise serializers.ValidationError(SUPPLIER_DOMAINS_INVALID_MESSAGE)
        return normalized

    def validate_homepage_url(self, value):
        homepage_url = (value or '').strip()
        if not homepage_url:
            return ''
        if not homepage_url.startswith(('http://', 'https://')):
            homepage_url = f'https://{homepage_url}'
        from django.core.validators import URLValidator

        try:
            URLValidator()(homepage_url)
        except ValidationError as exc:
            raise serializers.ValidationError(SUPPLIER_HOMEPAGE_INVALID_MESSAGE) from exc
        return homepage_url

    def validate_name(self, value):
        from farm.utils import normalize_supplier_name

        name = (value or '').strip()
        if not name:
            raise serializers.ValidationError(SUPPLIER_NAME_REQUIRED_MESSAGE)
        project = _resolve_active_project_from_serializer(self)
        if project is None:
            return name
        normalized = normalize_supplier_name(name) or ''
        queryset = Supplier.objects.filter(project=project, name_normalized=normalized)
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError(SUPPLIER_NAME_DUPLICATE_MESSAGE)
        return name


    class Meta:
        model = Supplier
        fields = ['id', 'name', 'homepage_url', 'slug', 'allowed_domains', 'created_at', 'updated_at', 'created']
        read_only_fields = ['created_at', 'updated_at', 'slug']


def _has_text_value(value: object) -> bool:
    return isinstance(value, str) and value.strip() != ''


def _supplier_data_payload_has_supplier(row: dict[str, object]) -> bool:
    return (
        row.get('supplier_id') is not None
        or row.get('supplier') is not None
        or _has_text_value(row.get('supplier_name_input'))
    )


def _supplier_data_payload_has_information(row: dict[str, object]) -> bool:
    return (
        _has_text_value(row.get('supplier_product_name'))
        or _has_text_value(row.get('supplier_product_url'))
        or _has_text_value(row.get('supplier_url'))
        or _has_text_value(row.get('notes'))
        or _has_text_value(row.get('source_url'))
        or row.get('germination_rate') is not None
        or row.get('price') is not None
        or bool(row.get('packaging_sizes'))
    )


def _is_empty_supplier_data_payload(row: dict[str, object]) -> bool:
    return not _supplier_data_payload_has_supplier(row) and not _supplier_data_payload_has_information(row)


class CropSupplierDataSerializer(serializers.ModelSerializer):
    supplier = SupplierSerializer(read_only=True)
    supplier_id = serializers.PrimaryKeyRelatedField(
        queryset=Supplier.objects.all(),
        source='supplier',
        write_only=True,
        required=False,
        allow_null=True,
    )
    supplier_name_input = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = CropSupplierData
        fields = [
            'id',
            'crop',
            'project',
            'supplier',
            'supplier_id',
            'supplier_name',
            'supplier_name_input',
            'supplier_url',
            'supplier_product_name',
            'supplier_product_url',
            'packaging_sizes',
            'germination_rate',
            'price',
            'notes',
            'source_url',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'project']
        extra_kwargs = {'crop': {'required': False}}
        validators = []

    def _resolve_crop_for_validation(self, attrs):
        crop = attrs.get('crop')
        if crop is not None:
            return crop
        if self.instance is not None:
            return self.instance.crop
        return self.context.get('parent_crop')

    def _validate_unique_crop_supplier(self, attrs):
        crop = self._resolve_crop_for_validation(attrs)
        supplier = attrs.get('supplier') or (self.instance.supplier if self.instance is not None else None)
        if crop is None or supplier is None:
            return

        queryset = CropSupplierData.objects.filter(crop=crop, supplier=supplier)
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError({
                'supplier_id': 'supplier_data_duplicate',
            })

    def validate(self, attrs):
        attrs = super().validate(attrs)
        raw_initial_data = getattr(self, 'initial_data', None)
        if isinstance(raw_initial_data, dict) and 'thousand_kernel_weight_g' in raw_initial_data:
            raise serializers.ValidationError({
                'thousand_kernel_weight_g': 'supplier_specific_tkg_unsupported',
            })
        project = _resolve_active_project_from_serializer(self)
        crop = self._resolve_crop_for_validation(attrs)
        supplier = attrs.get('supplier') if 'supplier' in attrs else (self.instance.supplier if self.instance is not None else None)
        if project is not None and crop is not None and crop.project_id != project.id:
            raise serializers.ValidationError({'crop': 'crop_project_mismatch'})
        if project is not None and supplier is not None and supplier.project_id != project.id:
            raise serializers.ValidationError({'supplier_id': 'supplier_project_mismatch'})
        supplier_name_input = attrs.pop('supplier_name_input', None)
        if not attrs.get('supplier') and supplier_name_input:
            from farm.utils import normalize_supplier_name

            project = _resolve_active_project_from_serializer(self)
            if project is None:
                raise serializers.ValidationError({'supplier': 'Supplier is required.'})

            normalized = normalize_supplier_name(supplier_name_input) or ''
            try:
                with transaction.atomic():
                    supplier, _ = Supplier.objects.get_or_create(
                        project=project,
                        name_normalized=normalized,
                        defaults={
                            'name': supplier_name_input.strip(),
                            'homepage_url': 'https://example.invalid',
                            'project': project,
                        },
                    )
            except IntegrityError as exc:
                supplier = Supplier.objects.filter(project=project, name_normalized=normalized).first()
                if supplier is None:
                    raise serializers.ValidationError({'supplier': 'Lieferant konnte nicht gespeichert werden.'}) from exc
            attrs['supplier'] = supplier
            attrs['supplier_name'] = supplier.name

        supplier = attrs.get('supplier') if 'supplier' in attrs else (self.instance.supplier if self.instance is not None else None)
        if supplier is None:
            raise serializers.ValidationError({
                'supplier_id': 'supplier_data_missing_supplier',
            })

        self._validate_unique_crop_supplier(attrs)
        return attrs
