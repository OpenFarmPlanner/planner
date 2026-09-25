import { describe, expect, it } from 'vitest';
import type { PublicCropSyncFieldChange } from '../api/types';
import {
  buildDefaultSyncChoices,
  buildUniformSyncChoices,
  getDefaultSyncChoice,
  splitSyncChoices,
} from '../crops/publicCropSync';

const change = (over: Partial<PublicCropSyncFieldChange>): PublicCropSyncFieldChange => ({
  field: 'growth_duration_days',
  local_value: 60,
  public_value: 50,
  pushable: true,
  ...over,
});

describe('getDefaultSyncChoice', () => {
  it('takes the library value when only the library has one', () => {
    expect(getDefaultSyncChoice(change({ local_value: null, public_value: 50 }))).toBe('library');
    expect(getDefaultSyncChoice(change({ field: 'notes', local_value: '', public_value: 'Text' }))).toBe('library');
  });

  it('keeps the local value when only the local crop has one', () => {
    expect(getDefaultSyncChoice(change({ local_value: 60, public_value: null }))).toBe('mine');
    expect(getDefaultSyncChoice(change({ field: 'cultivation_types', local_value: ['direct_sowing'], public_value: [] })))
      .toBe('mine');
  });

  it('prefers the library value when both are set and differ', () => {
    expect(getDefaultSyncChoice(change({ local_value: 60, public_value: 50 }))).toBe('library');
  });

  it('never preselects pushing a field that cannot be pushed', () => {
    expect(getDefaultSyncChoice(change({ field: 'name', local_value: 'Tomate', public_value: '', pushable: false })))
      .toBe('library');
  });
});

describe('sync quick actions and split', () => {
  const changes = [
    change({ field: 'growth_duration_days', local_value: 60, public_value: 50 }),
    change({ field: 'notes', local_value: 'Mein Text', public_value: '' }),
    change({ field: 'name', local_value: 'Tomate', public_value: 'Tomato', pushable: false }),
  ];

  it('preselects every field by the rules', () => {
    expect(buildDefaultSyncChoices(changes)).toEqual({
      growth_duration_days: 'library',
      notes: 'mine',
      name: 'library',
    });
  });

  it('"Alle aus Bibliothek" pulls everything', () => {
    const choices = buildUniformSyncChoices(changes, 'library');
    expect(splitSyncChoices(changes, choices)).toEqual({
      pullFields: ['growth_duration_days', 'notes', 'name'],
      pushFields: [],
    });
  });

  it('"Alle meine Werte" pushes everything that may be pushed', () => {
    const choices = buildUniformSyncChoices(changes, 'mine');
    expect(splitSyncChoices(changes, choices)).toEqual({
      pullFields: ['name'],
      pushFields: ['growth_duration_days', 'notes'],
    });
  });
});
