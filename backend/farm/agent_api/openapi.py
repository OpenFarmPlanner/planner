"""Machine-readable description of the endpoints reachable with an API token.

The crop schema is generated from :mod:`farm.services.crop_import.field_specs`
rather than written by hand, so the units, enums, and bounds an agent reads here
are literally the ones the validator enforces. When a bound changes, the
document changes with it.
"""

from __future__ import annotations

from typing import Any

from farm.services.crop_import.field_specs import (
    CROP_FIELD_SPECS,
    KIND_BOOLEAN,
    KIND_COLOR,
    KIND_ENUM,
    KIND_ENUM_LIST,
    KIND_INTEGER,
    KIND_NUMBER,
    KIND_STRING,
    KIND_STRING_LIST,
    FieldSpec,
    seed_rate_unit_constraints_payload,
)

OPENAPI_VERSION = '3.1.0'

_JSON_TYPE_BY_KIND = {
    KIND_STRING: 'string',
    KIND_ENUM: 'string',
    KIND_COLOR: 'string',
    KIND_INTEGER: 'integer',
    KIND_NUMBER: 'number',
    KIND_BOOLEAN: 'boolean',
    KIND_ENUM_LIST: 'array',
    KIND_STRING_LIST: 'array',
}


def _field_schema(spec: FieldSpec) -> dict[str, Any]:
    """Render one field spec as a JSON Schema fragment."""
    schema: dict[str, Any] = {
        'type': _JSON_TYPE_BY_KIND[spec.kind],
        'description': _field_description(spec),
        'examples': [spec.example],
    }
    if spec.kind == KIND_ENUM_LIST:
        schema['items'] = {'type': 'string', 'enum': list(spec.enum_values or ())}
        schema['uniqueItems'] = True
    elif spec.kind == KIND_STRING_LIST:
        schema['items'] = {'type': 'string'}
    elif spec.enum_values:
        schema['enum'] = list(spec.enum_values)

    if spec.unit:
        # Non-standard but widely used: makes the unit machine-readable
        # instead of hiding it inside prose.
        schema['x-unit'] = spec.unit
    if spec.max_length is not None:
        schema['maxLength'] = spec.max_length
    _apply_numeric_bounds(spec, schema)
    if spec.requires:
        schema['x-requires'] = spec.requires
    if spec.name in {'seed_rate_direct_value', 'seed_rate_pre_cultivation_value'}:
        schema['x-unit-value-constraints'] = seed_rate_unit_constraints_payload()
    if spec.accepted_keys[1:]:
        schema['x-accepted-input-keys'] = list(spec.accepted_keys)
    return schema


def _apply_numeric_bounds(spec: FieldSpec, schema: dict[str, Any]) -> None:
    """Add hard bounds as JSON Schema limits and plausible bounds as extensions."""
    if spec.hard_min is not None:
        if spec.exclusive_min:
            schema['exclusiveMinimum'] = spec.hard_min
        else:
            schema['minimum'] = spec.hard_min
    if spec.hard_max is not None:
        schema['maximum'] = spec.hard_max
    if spec.warn_min is not None:
        schema['x-plausible-minimum'] = spec.warn_min
    if spec.warn_max is not None:
        schema['x-plausible-maximum'] = spec.warn_max


def _field_description(spec: FieldSpec) -> str:
    """Compose the human-readable description, including unit and bounds."""
    parts = [spec.description]
    if spec.unit:
        parts.append(f'Unit: {spec.unit}.')
    if spec.warn_min is not None or spec.warn_max is not None:
        low = spec.warn_min if spec.warn_min is not None else '−∞'
        high = spec.warn_max if spec.warn_max is not None else '∞'
        parts.append(f'Values outside {low}–{high} are accepted but reported as a warning.')
    if spec.requires:
        parts.append(f'Must be sent together with {spec.requires}.')
    if spec.notes:
        parts.append(spec.notes)
    return ' '.join(parts)


def build_crop_import_item_schema() -> dict[str, Any]:
    """Return the JSON Schema for one row of a crop-import payload."""
    return {
        'type': 'object',
        'title': 'CropImportItem',
        'description': (
            'One crop in an import payload. Send only fields the source '
            'actually contains — a missing field is left untouched, whereas a '
            'guessed field silently corrupts the record. Unknown keys are '
            'reported under ignored_fields and never mapped onto another field.'
        ),
        'required': ['name'],
        'additionalProperties': True,
        'properties': {spec.name: _field_schema(spec) for spec in CROP_FIELD_SPECS},
    }


def _seed_requirements_schema() -> dict[str, Any]:
    """Return the preferred seed-rate schema for crop create/update."""
    entry_schema = {
        'type': 'object',
        'required': ['value', 'unit'],
        'additionalProperties': False,
        'x-unit-value-constraints': seed_rate_unit_constraints_payload(),
        'properties': {
            'value': {
                'type': 'number',
                'exclusiveMinimum': 0,
                'description': 'Seed rate value. This is not the total amount to buy.',
                'examples': [2],
            },
            'unit': {
                'type': 'string',
                'enum': [
                    'g_per_m2',
                    'g_per_lfm',
                    'seeds_per_m2',
                    'seeds_per_lfm',
                    'seeds_per_plant',
                ],
                'description': (
                    'Unit that defines whether the value is per area, row metre, '
                    'or plant.'
                ),
                'examples': ['seeds_per_plant'],
            },
            'safety_percent': {
                'type': 'number',
                'minimum': 0,
                'maximum': 100,
                'description': 'Optional extra seed margin added during demand calculation.',
                'examples': [10],
            },
        },
    }
    return {
        'type': 'object',
        'description': (
            'Preferred agent-facing seed-rate object. Keys are cultivation methods; '
            'values describe seed rate per area, row metre, or target plant. '
            'Use this instead of legacy seeding_requirement fields. Total seed '
            'demand is calculated later from planting area or plant count. '
            'Unit-specific value constraints are published in x-unit-value-constraints; '
            'for example, seeds_per_plant requires a whole-number value.'
        ),
        'additionalProperties': False,
        'properties': {
            'direct_sowing': entry_schema,
            'pre_cultivation': entry_schema,
        },
        'examples': [
            {'pre_cultivation': {'value': 2, 'unit': 'seeds_per_plant'}},
            {'direct_sowing': {'value': 1.5, 'unit': 'g_per_m2', 'safety_percent': 10}},
        ],
    }


def build_crop_write_item_schema() -> dict[str, Any]:
    """Return the JSON Schema for direct crop create/update payloads."""
    properties = {spec.name: _field_schema(spec) for spec in CROP_FIELD_SPECS}
    properties['variety']['type'] = ['string', 'null']
    properties['seed_requirements'] = _seed_requirements_schema()
    return {
        'type': 'object',
        'title': 'CropWriteItem',
        'description': (
            'Crop create/update payload. For seed rates, prefer seed_requirements: '
            'it states the cultivation method and unit in one object. The older '
            'seed_rate_* fields remain accepted for compatibility.'
        ),
        'required': ['name'],
        'additionalProperties': True,
        'properties': properties,
    }


def _crop_write_request_body(*, required: bool) -> dict[str, Any]:
    """Return the request body schema for crop create/update endpoints."""
    return {
        'required': required,
        'content': {
            'application/json': {
                'schema': {'$ref': '#/components/schemas/CropWriteItem'},
                'examples': {
                    'generalCrop': {
                        'summary': 'Species-level general crop data',
                        'value': {
                            'name': 'Tomate',
                            'variety': '',
                            'crop_family': 'Solanaceae',
                            'growth_duration_days': 80,
                        },
                    },
                    'preCultivatedTomato': {
                        'summary': 'Pre-cultivated tomato',
                        'value': {
                            'name': 'Tomate',
                            'variety': 'San Marzano',
                            'cultivation_types': ['pre_cultivation'],
                            'seed_requirements': {
                                'pre_cultivation': {
                                    'value': 2,
                                    'unit': 'seeds_per_plant',
                                }
                            },
                        },
                    },
                    'directSownCarrot': {
                        'summary': 'Direct-sown carrot by area',
                        'value': {
                            'name': 'Karotte',
                            'variety': 'Nantaise',
                            'cultivation_types': ['direct_sowing'],
                            'seed_requirements': {
                                'direct_sowing': {
                                    'value': 1.5,
                                    'unit': 'g_per_m2',
                                    'safety_percent': 10,
                                }
                            },
                        },
                    },
                },
            }
        },
    }


def _preview_field_schema() -> dict[str, Any]:
    """Return the schema of one row/field entry in an import preview."""
    return {
        'type': 'object',
        'title': 'CropImportPreviewField',
        'properties': {
            'field': {'type': 'string', 'description': 'Canonical API field name.'},
            'source_key': {'type': 'string', 'description': 'Key as it appeared in the payload.'},
            'source_value': {'description': 'Value as it appeared in the payload.'},
            'source_unit': {
                'type': ['string', 'null'],
                'description': 'Unit detected in the source, or null when none was stated.',
            },
            'api_value': {'description': 'Normalized value that would be stored, or null.'},
            'api_unit': {'type': ['string', 'null'], 'description': 'Canonical unit of api_value.'},
            'confidence': {
                'type': 'string',
                'enum': ['exact', 'converted', 'needs_clarification', 'invalid'],
                'description': (
                    'exact: stated in the canonical unit. converted: unambiguously '
                    'converted. needs_clarification: no usable unit — the value is '
                    'not stored. invalid: rejected.'
                ),
            },
            'current_value': {'description': 'Currently stored value when a crop matched.'},
            'changes_existing': {'type': 'boolean'},
            'warnings': {'type': 'array', 'items': {'$ref': '#/components/schemas/Issue'}},
            'errors': {'type': 'array', 'items': {'$ref': '#/components/schemas/Issue'}},
        },
    }


def _preview_item_schema() -> dict[str, Any]:
    """Return the schema of one analyzed row in an import preview."""
    return {
        'type': 'object',
        'title': 'CropImportPreviewItem',
        'properties': {
            'index': {'type': 'integer'},
            'action': {
                'type': 'string',
                'enum': ['create', 'update', 'skip', 'blocked'],
                'description': (
                    'What applying the draft would do. "skip" means the stored '
                    'crop already matches; "blocked" rows prevent the whole '
                    'draft from being applied.'
                ),
            },
            'identity': {
                'type': 'object',
                'description': 'The name/variety/supplier trio used for matching.',
                'properties': {
                    'name': {'type': 'string'},
                    'variety': {'type': 'string'},
                    'supplier_name': {'type': 'string'},
                },
            },
            'matched_crop_id': {'type': ['integer', 'null']},
            'matched_by': {'type': ['string', 'null']},
            'fields': {
                'type': 'array',
                'items': {'$ref': '#/components/schemas/CropImportPreviewField'},
            },
            'ignored_fields': {
                'type': 'array',
                'description': 'Payload keys that are not part of the crop schema.',
                'items': {'type': 'object'},
            },
            'warnings': {'type': 'array', 'items': {'$ref': '#/components/schemas/Issue'}},
            'errors': {'type': 'array', 'items': {'$ref': '#/components/schemas/Issue'}},
        },
    }


def _draft_schema() -> dict[str, Any]:
    """Return the schema of a stored import draft."""
    return {
        'type': 'object',
        'title': 'CropImportDraft',
        'properties': {
            'draft_id': {'type': 'string', 'format': 'uuid'},
            'checksum': {
                'type': 'string',
                'description': 'Echo this back in the apply call to confirm this exact preview.',
            },
            'status': {'type': 'string', 'enum': ['pending', 'applied']},
            'source_label': {'type': 'string'},
            'created_at': {'type': 'string', 'format': 'date-time'},
            'expires_at': {'type': 'string', 'format': 'date-time'},
            'applied_at': {'type': ['string', 'null'], 'format': 'date-time'},
            'has_errors': {'type': 'boolean'},
            'has_warnings': {'type': 'boolean'},
            'requires_confirmation': {'type': 'boolean'},
            'summary': {'type': 'object'},
            'items': {
                'type': 'array',
                'items': {'$ref': '#/components/schemas/CropImportPreviewItem'},
            },
            'result': {'type': ['object', 'null']},
        },
    }


def _crop_paths() -> dict[str, Any]:
    """Return the path items for crop CRUD reachable with an API token."""
    project_note = (
        'The project is taken from the API token; X-Project-Id is optional and, '
        'if sent, must match the bound project.'
    )
    return {
        '/crops/': {
            'get': {
                'summary': 'List crops of the bound project',
                'description': f'Requires scope `read`. {project_note}',
                'tags': ['crops'],
                'parameters': [
                    {'name': 'page', 'in': 'query', 'schema': {'type': 'integer', 'minimum': 1}},
                    {
                        'name': 'page_size',
                        'in': 'query',
                        'schema': {'type': 'integer', 'minimum': 1},
                    },
                ],
                'responses': {'200': {'description': 'Paginated crop list.'}},
            },
            'post': {
                'summary': 'Create a crop',
                'description': (
                    'Requires scope `write`. Distances use the centimetre field '
                    'spellings (row_spacing_cm, …) on this endpoint; the import '
                    'endpoints additionally accept the metre spellings. '
                    f'{project_note}'
                ),
                'tags': ['crops'],
                'requestBody': _crop_write_request_body(required=True),
                'responses': {'201': {'description': 'Created crop.'}},
            },
        },
        '/crops/{id}/': {
            'parameters': [
                {'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'integer'}},
            ],
            'get': {
                'summary': 'Retrieve one crop of the bound project',
                'description': (
                    'Requires scope `read`. Ids outside the bound project return '
                    '404, never another project\'s data.'
                ),
                'tags': ['crops'],
                'responses': {
                    '200': {'description': 'Crop.'},
                    '404': {'description': 'Not found.'},
                },
            },
            'patch': {
                'summary': 'Partially update one crop',
                'description': 'Requires scope `write`.',
                'tags': ['crops'],
                'requestBody': _crop_write_request_body(required=False),
                'responses': {'200': {'description': 'Updated crop.'}},
            },
            'put': {
                'summary': 'Replace one crop',
                'description': 'Requires scope `write`.',
                'tags': ['crops'],
                'requestBody': _crop_write_request_body(required=True),
                'responses': {'200': {'description': 'Updated crop.'}},
            },
            'delete': {
                'summary': 'Soft-delete one crop',
                'description': (
                    'Requires scope `delete`. This marks the crop as deleted '
                    'inside the bound project; it does not hard-delete history.'
                ),
                'tags': ['crops'],
                'responses': {
                    '204': {'description': 'Crop soft-deleted.'},
                    '404': {'description': 'Not found.'},
                },
            },
        },
        '/crops/{id}/undelete/': {
            'parameters': [
                {'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'integer'}},
            ],
            'post': {
                'summary': 'Restore a soft-deleted crop',
                'description': 'Requires scope `delete`.',
                'tags': ['crops'],
                'responses': {
                    '200': {'description': 'Restored crop.'},
                    '404': {'description': 'Not found.'},
                },
            },
        },
    }


def _import_paths() -> dict[str, Any]:
    """Return the path items for the two-step crop import."""
    return {
        '/crop-imports/preview/': {
            'post': {
                'summary': 'Validate a crop import without writing anything',
                'description': (
                    'Requires scope `write` (it creates a draft, but no crop '
                    'data). Returns a per-row, per-field analysis plus a draft id '
                    'and checksum to confirm in the apply step.'
                ),
                'tags': ['crop-imports'],
                'requestBody': {
                    'required': True,
                    'content': {
                        'application/json': {
                            'schema': {
                                'type': 'object',
                                'required': ['items'],
                                'properties': {
                                    'items': {
                                        'type': 'array',
                                        'minItems': 1,
                                        'items': {'$ref': '#/components/schemas/CropImportItem'},
                                    },
                                    'source_label': {'type': 'string', 'maxLength': 200},
                                },
                            }
                        }
                    },
                },
                'responses': {
                    '200': {
                        'description': 'Import draft with the full preview.',
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/CropImportDraft'}
                            }
                        },
                    }
                },
            }
        },
        '/crop-imports/{draft_id}/': {
            'parameters': [
                {
                    'name': 'draft_id',
                    'in': 'path',
                    'required': True,
                    'schema': {'type': 'string', 'format': 'uuid'},
                },
            ],
            'get': {
                'summary': 'Re-read a stored import draft',
                'description': 'Requires scope `read`.',
                'tags': ['crop-imports'],
                'responses': {
                    '200': {
                        'description': 'The stored draft.',
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/CropImportDraft'}
                            }
                        },
                    }
                },
            },
        },
        '/crop-imports/{draft_id}/apply/': {
            'parameters': [
                {
                    'name': 'draft_id',
                    'in': 'path',
                    'required': True,
                    'schema': {'type': 'string', 'format': 'uuid'},
                },
            ],
            'post': {
                'summary': 'Execute a reviewed and confirmed import',
                'description': (
                    'Requires scope `write`. Refuses drafts with errors, drafts '
                    'whose warnings were not acknowledged, expired drafts, and '
                    'checksums that do not match the stored preview. Applying an '
                    'already-applied draft returns the original result instead of '
                    'importing twice.'
                ),
                'tags': ['crop-imports'],
                'requestBody': {
                    'required': True,
                    'content': {
                        'application/json': {
                            'schema': {
                                'type': 'object',
                                'required': ['confirm', 'checksum'],
                                'properties': {
                                    'confirm': {
                                        'type': 'boolean',
                                        'description': (
                                            'Must be true; this is the explicit '
                                            'write confirmation.'
                                        ),
                                    },
                                    'checksum': {
                                        'type': 'string',
                                        'description': 'The checksum returned by the preview call.',
                                    },
                                    'acknowledge_warnings': {
                                        'type': 'boolean',
                                        'default': False,
                                        'description': 'Required when the draft has warnings.',
                                    },
                                },
                            }
                        }
                    },
                },
                'responses': {
                    '200': {'description': 'Import result.'},
                    '400': {'description': 'Draft not executable; see the "code" member.'},
                },
            },
        },
    }


def _read_only_collection_paths() -> dict[str, Any]:
    """Return the read-only supporting collections agents may query."""
    collections = {
        '/suppliers/': 'Seed suppliers of the bound project.',
        '/seed-packages/': 'Seed package sizes of the bound project.',
        '/crop-supplier-data/': 'Supplier-specific seed data of the bound project.',
        '/crop-companions/': "Good and bad neighbours of the bound project's crops.",
        '/locations/': 'Locations of the bound project.',
        '/fields/': 'Fields of the bound project.',
        '/beds/': 'Beds of the bound project.',
        '/planting-plans/': 'Planting plans of the bound project.',
        '/tasks/': 'Tasks of the bound project.',
    }
    return {
        path: {
            'get': {
                'summary': description,
                'description': 'Requires scope `read`. Always filtered to the bound project.',
                'tags': ['project-data'],
                'responses': {'200': {'description': 'Paginated list.'}},
            }
        }
        for path, description in collections.items()
    }


def _agent_context_path() -> dict[str, Any]:
    """Return the token self-context endpoint path item."""
    return {
        '/agent/context/': {
            'get': {
                'summary': 'Read the project context bound to this API token',
                'description': (
                    'Requires scope `read`. Returns only non-secret context for '
                    'the authenticating token so tools can confirm the target '
                    'project before writing. It does not expose project members '
                    'or any project list.'
                ),
                'tags': ['agent'],
                'responses': {
                    '200': {
                        'description': 'The token-bound project context.',
                        'content': {
                            'application/json': {
                                'schema': {'$ref': '#/components/schemas/AgentContext'}
                            }
                        },
                    },
                    '403': {'description': 'Returned for session-authenticated callers.'},
                },
            }
        }
    }


def build_openapi_document(*, server_url: str = '/api') -> dict[str, Any]:
    """Build the OpenAPI document for the agent-reachable API surface.

    :param server_url: Base URL the paths are relative to.
    :return: The OpenAPI document as a plain dictionary.
    """
    paths: dict[str, Any] = {}
    paths.update(_agent_context_path())
    paths.update(_crop_paths())
    paths.update(_import_paths())
    paths.update(_read_only_collection_paths())

    return {
        'openapi': OPENAPI_VERSION,
        'info': {
            'title': 'OpenFarmPlanner Agent API',
            'version': '1.0.0',
            'description': (
                'Endpoints reachable with a project-bound API token.\n\n'
                'Authenticate with `Authorization: Bearer <token>`. A token is '
                'permanently bound to one project; the server derives the project '
                'from the token, so no header or parameter can widen its reach. '
                'Tokens carry `read` (safe methods only), `write` (create and '
                'update), or `delete` (write plus crop soft-delete and restore) '
                'scope. Administrative endpoints — project members, invitations, '
                'account settings, Django admin — are unavailable to tokens.\n\n'
                'Distances are stored in SI metres. Field names state their unit '
                '(`row_spacing_m`, `sowing_depth_m`), and the import endpoints also '
                'accept the `_cm` and `_mm` spellings, converting them. A bare '
                '`row_spacing` without a unit is rejected rather than guessed.'
            ),
        },
        'servers': [{'url': server_url}],
        'security': [{'bearerAuth': []}],
        'components': {
            'securitySchemes': {
                'bearerAuth': {
                    'type': 'http',
                    'scheme': 'bearer',
                    'description': 'Project-bound personal API token, prefixed with `ofp_pat_`.',
                }
            },
            'schemas': {
                'Issue': {
                    'type': 'object',
                    'description': 'A machine-readable code plus a human-readable message.',
                    'properties': {
                        'code': {'type': 'string'},
                        'message': {'type': 'string'},
                        'field': {'type': 'string'},
                    },
                },
                'AgentContext': {
                    'type': 'object',
                    'description': 'Non-secret context for the authenticating project API token.',
                    'properties': {
                        'project_id': {
                            'type': 'integer',
                            'description': 'Project id permanently bound to the token.',
                        },
                        'project_name': {
                            'type': 'string',
                            'description': 'Human-readable name of the bound project.',
                        },
                        'token_scope': {
                            'type': 'string',
                            'enum': ['read', 'write', 'delete'],
                            'description': 'Scope carried by the token.',
                        },
                    },
                    'required': ['project_id', 'project_name', 'token_scope'],
                },
                'CropImportItem': build_crop_import_item_schema(),
                'CropWriteItem': build_crop_write_item_schema(),
                'CropImportPreviewField': _preview_field_schema(),
                'CropImportPreviewItem': _preview_item_schema(),
                'CropImportDraft': _draft_schema(),
            },
        },
        'paths': paths,
    }
