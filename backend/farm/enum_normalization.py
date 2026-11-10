from __future__ import annotations


def normalize_seed_rate_unit(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if not text or text == '-':
        return None

    mapping = {
        'g_per_m2': 'g_per_m2',
        'g/m²': 'g_per_m2',
        'g/m2': 'g_per_m2',
        'g per m²': 'g_per_m2',
        'g per m2': 'g_per_m2',
        'gramm pro quadratmeter': 'g_per_m2',
        'gramm pro m²': 'g_per_m2',
        'gramm pro m2': 'g_per_m2',
        'gramm je quadratmeter': 'g_per_m2',
        'gramm pro 100 quadratmeter': 'g_per_m2',
        'g pro 100 m²': 'g_per_m2',
        'g pro 100 m2': 'g_per_m2',
        'g_per_lfm': 'g_per_lfm',
        'g/lfm': 'g_per_lfm',
        'g per lfm': 'g_per_lfm',
        'gramm pro laufmeter': 'g_per_lfm',
        'seeds/m': 'seeds_per_lfm',
        'seeds per meter': 'seeds_per_lfm',
        'seeds per metre': 'seeds_per_lfm',
        'korn / lfm': 'seeds_per_lfm',
        'korn/lfm': 'seeds_per_lfm',
        'korn pro laufmeter': 'seeds_per_lfm',
        'seeds_per_lfm': 'seeds_per_lfm',
        'seeds_per_m2': 'seeds_per_m2',
        'seeds/m²': 'seeds_per_m2',
        'seeds/m2': 'seeds_per_m2',
        'seeds per m²': 'seeds_per_m2',
        'seeds per m2': 'seeds_per_m2',
        'korn / m²': 'seeds_per_m2',
        'korn / m2': 'seeds_per_m2',
        'seeds_per_plant': 'seeds_per_plant',
        'seeds per plant': 'seeds_per_plant',
        'pcs_per_plant': 'seeds_per_plant',
        'korn / pflanze': 'seeds_per_plant',
        'g per plant': 'seeds_per_plant',
    }
    return mapping.get(text)


def normalize_choice_value(field_name: str, value: object) -> object:
    text = str(value).strip().lower()
    if field_name == 'cultivation_type':
        mapping = {
            'direct_sowing': 'direct_sowing',
            'direct sowing': 'direct_sowing',
            'direktsaat': 'direct_sowing',
            'sowing direct': 'direct_sowing',
            'pre_cultivation': 'pre_cultivation',
            'pre cultivation': 'pre_cultivation',
            'anzucht': 'pre_cultivation',
            'pflanzung': 'pre_cultivation',
            'transplant': 'pre_cultivation',
            'transplanting': 'pre_cultivation',
            'bush bean': 'direct_sowing',
            'buschbohne': 'direct_sowing',
        }
        return mapping.get(text, text)

    if field_name == 'nutrient_demand':
        mapping = {
            'low': 'low',
            'niedrig': 'low',
            'medium': 'medium',
            'mittel': 'medium',
            'high': 'high',
            'hoch': 'high',
        }
        return mapping.get(text, text)

    if field_name == 'harvest_method':
        mapping = {
            'per_plant': 'per_plant',
            'per plant': 'per_plant',
            'pflanze': 'per_plant',
            'pro pflanze': 'per_plant',
            'per_sqm': 'per_sqm',
            'per sqm': 'per_sqm',
            'per m2': 'per_sqm',
            'pro m2': 'per_sqm',
            'pro m²': 'per_sqm',
            'per square meter': 'per_sqm',
        }
        return mapping.get(text, text)

    if field_name == 'light_requirement':
        mapping = {
            'full sun': 'full_sun', 'sun': 'full_sun', 'sonne': 'full_sun', 'sonnig': 'full_sun',
            'vollsonne': 'full_sun',
            'partial shade': 'partial_shade', 'part shade': 'partial_shade',
            'halbschatten': 'partial_shade', 'halbschattig': 'partial_shade',
            'shade': 'shade', 'schatten': 'shade', 'schattig': 'shade',
        }
        return mapping.get(text, text)

    if field_name == 'water_requirement':
        mapping = {
            'low': 'low', 'niedrig': 'low', 'gering': 'low',
            'medium': 'medium', 'mittel': 'medium',
            'high': 'high', 'hoch': 'high',
        }
        return mapping.get(text, text)

    if field_name == 'life_cycle':
        mapping = {
            'annual': 'annual', 'einjährig': 'annual', 'einjaehrig': 'annual',
            'biennial': 'biennial', 'zweijährig': 'biennial', 'zweijaehrig': 'biennial',
            'perennial': 'perennial', 'mehrjährig': 'perennial', 'mehrjaehrig': 'perennial',
            'ausdauernd': 'perennial',
        }
        return mapping.get(text, text)

    if field_name == 'winter_hardiness':
        mapping = {
            'hardy': 'hardy', 'winterhart': 'hardy', 'yes': 'hardy', 'ja': 'hardy',
            'with protection': 'with_protection', 'with winter protection': 'with_protection',
            'mit winterschutz': 'with_protection', 'bedingt winterhart': 'with_protection',
            'not hardy': 'not_hardy', 'nicht winterhart': 'not_hardy', 'no': 'not_hardy',
            'nein': 'not_hardy',
        }
        return mapping.get(text, text)

    if field_name == 'seed_rate_unit':
        return normalize_seed_rate_unit(text) or text

    return value
