import { beforeEach, describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '../i18n';
import type { PublicCrop, PublicCropDiscussionComment } from '../api/types';
import {
  LEGACY_SELECTED_PUBLIC_CROP_STORAGE_KEY,
  PUBLIC_CROP_LIBRARY_VIEW_STATE_STORAGE_KEY,
  SELECTED_PUBLIC_CROP_STORAGE_KEY,
  arePublicValuesEqual,
  buildPublicCropDescriptionDrafts,
  buildThreadCommentTree,
  compareComments,
  formatDays,
  formatDiscussionPreview,
  formatLocalizedNumber,
  formatMetersAsCentimeters,
  formatPublicCropValue,
  getCommentTimestamp,
  getCultivationTypesLabel,
  getDeletedCommentPlaceholder,
  getHarvestMethodLabel,
  getNutrientDemandLabel,
  getPublicCropFieldLabel,
  getPublicCropOriginalLanguageCode,
  getPublicCropTabIndex,
  getRevisionValueLabel,
  getStoredPublicCropId,
  getStoredPublicCropLibraryViewState,
  isEmptyPublicValue,
  isPublicCropTab,
  parsePublicCropId,
  storePublicCropLibraryViewState,
} from '../crop-library/components/publicCropLibrary/formatters';

const t = i18n.getFixedT('de', 'crops') as TFunction;

const comment = (
  overrides: Partial<PublicCropDiscussionComment> & { id: number },
): PublicCropDiscussionComment => ({
  created_at: '2026-01-01T00:00:00Z',
  parent: null,
  body: '',
  ...overrides,
}) as PublicCropDiscussionComment;

const crop = (overrides: Partial<PublicCrop> = {}): PublicCrop => ({
  id: 1, name: 'Möhre', ...overrides,
}) as PublicCrop;

beforeEach(() => {
  window.localStorage.clear();
});

describe('parsePublicCropId', () => {
  it('parses a stored id', () => {
    expect(parsePublicCropId('42')).toBe(42);
  });

  it('reads a decimal id as its integer part, since parseInt stops at the dot', () => {
    expect(parsePublicCropId('42.9')).toBe(42);
  });

  it('takes the leading number out of a mixed string', () => {
    // parseInt is deliberately lenient here; recorded so a switch to Number()
    // would be a visible change rather than a silent one.
    expect(parsePublicCropId('42abc')).toBe(42);
  });

  it.each([
    ['an empty string', ''],
    ['null', null],
    ['a non-numeric string', 'abc'],
  ])('has no id for %s', (_label, value) => {
    // The leading `if (!value)` is redundant against the finiteness check that
    // follows: parseInt('') and parseInt(null) are both NaN, which that check
    // already rejects. Removing it leaves this file green.
    expect(parsePublicCropId(value)).toBeNull();
  });

  it('parses in base ten, so an 0x-prefixed value is not read as hex', () => {
    // Without the explicit radix, parseInt('0x10') is 16.
    expect(parsePublicCropId('0x10')).toBe(0);
  });

  it('reads "0" as zero rather than as absent', () => {
    // The guard is `!value`, which rejects '' and null but not '0'.
    expect(parsePublicCropId('0')).toBe(0);
  });
});

describe('getStoredPublicCropId', () => {
  it('reads the current key', () => {
    window.localStorage.setItem(SELECTED_PUBLIC_CROP_STORAGE_KEY, '7');
    expect(getStoredPublicCropId()).toBe(7);
  });

  it('falls back to the pre-rename key for a returning user', () => {
    window.localStorage.setItem(LEGACY_SELECTED_PUBLIC_CROP_STORAGE_KEY, '9');
    expect(getStoredPublicCropId()).toBe(9);
  });

  it('prefers the current key when both are present', () => {
    window.localStorage.setItem(SELECTED_PUBLIC_CROP_STORAGE_KEY, '7');
    window.localStorage.setItem(LEGACY_SELECTED_PUBLIC_CROP_STORAGE_KEY, '9');
    expect(getStoredPublicCropId()).toBe(7);
  });

  it('has no id when neither key is set', () => {
    expect(getStoredPublicCropId()).toBeNull();
  });
});

describe('getPublicCropTabIndex', () => {
  it('forces the discussion tab when a discussion is addressed', () => {
    // A link straight to a comment must land on the discussion, whatever the
    // tab parameter happens to say.
    expect(getPublicCropTabIndex('versions', 12)).toBe(2);
  });

  it('honours a named tab', () => {
    expect(getPublicCropTabIndex('versions', null)).toBe(1);
    expect(getPublicCropTabIndex('discussion', null)).toBe(2);
  });

  it('falls back to the details tab for anything else', () => {
    expect(getPublicCropTabIndex('details', null)).toBe(0);
    expect(getPublicCropTabIndex('nonsense', null)).toBe(0);
    expect(getPublicCropTabIndex(null, null)).toBe(0);
  });
});

describe('isPublicCropTab', () => {
  it('accepts the three real tabs', () => {
    expect(['details', 'versions', 'discussion'].every(isPublicCropTab)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isPublicCropTab('detail')).toBe(false);
    expect(isPublicCropTab(0)).toBe(false);
    expect(isPublicCropTab(undefined)).toBe(false);
  });
});

describe('public crop library view state', () => {
  const state = {
    cropId: 3, tab: 'versions' as const, discussionId: 5, query: 'möhre', listScrollTop: 120,
  };

  it('round-trips through storage', () => {
    storePublicCropLibraryViewState(state);
    expect(getStoredPublicCropLibraryViewState()).toEqual(state);
  });

  it('has no state when nothing is stored', () => {
    expect(getStoredPublicCropLibraryViewState()).toBeNull();
  });

  it('survives unparsable JSON rather than throwing on load', () => {
    window.localStorage.setItem(PUBLIC_CROP_LIBRARY_VIEW_STATE_STORAGE_KEY, '{ not json');
    expect(getStoredPublicCropLibraryViewState()).toBeNull();
  });

  it('discards a payload with no usable crop id', () => {
    window.localStorage.setItem(
      PUBLIC_CROP_LIBRARY_VIEW_STATE_STORAGE_KEY,
      JSON.stringify({ ...state, cropId: 'three' }),
    );
    expect(getStoredPublicCropLibraryViewState()).toBeNull();
  });
});

describe('getCommentTimestamp / compareComments', () => {
  it('orders by creation time', () => {
    const older = comment({ id: 2, created_at: '2026-01-01T00:00:00Z' });
    const newer = comment({ id: 1, created_at: '2026-06-01T00:00:00Z' });
    expect(compareComments(older, newer)).toBeLessThan(0);
  });

  it('breaks a tie by id, so the order is stable', () => {
    const first = comment({ id: 1 });
    const second = comment({ id: 2 });
    expect(compareComments(first, second)).toBeLessThan(0);
    expect(compareComments(second, first)).toBeGreaterThan(0);
  });

  it('treats a missing or unparsable timestamp as the epoch', () => {
    // The `!created_at` guard is redundant here too: `new Date(null)` is the
    // epoch and `new Date(undefined)` is Invalid Date, which the finiteness
    // check below already maps to 0.
    expect(getCommentTimestamp(comment({ id: 1, created_at: null as never }))).toBe(0);
    expect(getCommentTimestamp(comment({ id: 1, created_at: undefined as never }))).toBe(0);
    expect(getCommentTimestamp(comment({ id: 1, created_at: 'gestern' }))).toBe(0);
  });
});

describe('buildThreadCommentTree', () => {
  it('nests replies under their parent', () => {
    const tree = buildThreadCommentTree([
      comment({ id: 1 }),
      comment({ id: 2, parent: 1 }),
      comment({ id: 3, parent: 2 }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].comment.id).toBe(2);
    expect(tree[0].children[0].children[0].comment.id).toBe(3);
  });

  it('sorts siblings at every depth, not only at the root', () => {
    // Note: `sortTree`'s recursion into `children` cannot change this result.
    // The comments are sorted once before being inserted into the Map, and a
    // Map preserves insertion order, so every children array is already in
    // sorted order by the time it is built. Removing the recursive call leaves
    // this file green — the ordering is a property of the build step, not of
    // the sort that follows it.
    const tree = buildThreadCommentTree([
      comment({ id: 1 }),
      comment({ id: 3, parent: 1, created_at: '2026-06-01T00:00:00Z' }),
      comment({ id: 2, parent: 1, created_at: '2026-03-01T00:00:00Z' }),
    ]);

    expect(tree[0].children.map((child) => child.comment.id)).toEqual([2, 3]);
  });

  it('promotes a reply whose parent is missing to a root, rather than losing it', () => {
    // A parent hidden by moderation would otherwise take its replies with it.
    const tree = buildThreadCommentTree([comment({ id: 2, parent: 99 })]);
    expect(tree.map((node) => node.comment.id)).toEqual([2]);
  });

  it('does not let a comment parent itself into an infinite tree', () => {
    const tree = buildThreadCommentTree([comment({ id: 1, parent: 1 })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(0);
  });

  it('has nothing to build from an empty thread', () => {
    expect(buildThreadCommentTree([])).toEqual([]);
  });

  it('leaves the caller’s array untouched', () => {
    const comments = [comment({ id: 2 }), comment({ id: 1 })];
    buildThreadCommentTree(comments);
    expect(comments.map((entry) => entry.id)).toEqual([2, 1]);
  });
});

describe('getDeletedCommentPlaceholder', () => {
  it('says who removed the post, because that changes what a reader should infer', () => {
    expect(getDeletedCommentPlaceholder(
      comment({ id: 1, deletion_kind: 'author' } as never), t,
    )).toBe('Dieser Beitrag wurde vom Autor gelöscht.');
    expect(getDeletedCommentPlaceholder(
      comment({ id: 1, deletion_kind: 'moderator' } as never), t,
    )).toBe('Dieser Beitrag wurde von einem Moderator entfernt.');
  });

  it('falls back to the neutral wording when the reason is unknown', () => {
    expect(getDeletedCommentPlaceholder(comment({ id: 1 }), t))
      .toBe('Dieser Beitrag wurde gelöscht.');
  });
});

describe('formatDiscussionPreview', () => {
  it('strips markdown so a preview line reads as plain text', () => {
    expect(formatDiscussionPreview('**Fett** und _kursiv_ mit `Code`'))
      .toBe('Fett und kursiv mit Code');
  });

  it('collapses newlines and runs of spaces into single spaces', () => {
    expect(formatDiscussionPreview('Erste Zeile\n\n  Zweite   Zeile')).toBe('Erste Zeile Zweite Zeile');
  });

  it('removes link syntax, running the label into the URL', () => {
    // The brackets and parentheses are stripped without replacement, so the
    // link text and its target end up joined. Recorded as the current output;
    // a preview line is a rough summary rather than a rendered link.
    expect(formatDiscussionPreview('siehe [Anleitung](https://x.example)'))
      .toBe('siehe Anleitunghttps://x.example');
  });

  it('trims the ends, which collapsing whitespace alone would leave behind', () => {
    expect(formatDiscussionPreview('   Hallo Welt   ')).toBe('Hallo Welt');
  });

  it('has an empty preview for missing text', () => {
    expect(formatDiscussionPreview(null)).toBe('');
    expect(formatDiscussionPreview(undefined)).toBe('');
  });
});

describe('formatLocalizedNumber', () => {
  it('uses the German decimal comma', () => {
    expect(formatLocalizedNumber(1234.5, 'de', '—')).toBe('1.234,5');
  });

  it('formats the same value differently for another locale', () => {
    expect(formatLocalizedNumber(1234.5, 'en', '—')).toBe('1,234.5');
  });

  it('accepts a numeric string, since API values arrive as decimals', () => {
    expect(formatLocalizedNumber('2.5', 'de', '—')).toBe('2,5');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a non-numeric string', 'viel'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('falls back for %s', (_label, value) => {
    expect(formatLocalizedNumber(value as never, 'de', '—')).toBe('—');
  });

  it('formats zero rather than treating it as missing', () => {
    expect(formatLocalizedNumber(0, 'de', '—')).toBe('0');
  });

  it('passes formatting options through', () => {
    expect(formatLocalizedNumber(2.567, 'de', '—', { maximumFractionDigits: 1 })).toBe('2,6');
  });
});

describe('formatDays', () => {
  it('appends the localized unit', () => {
    expect(formatDays(14, 'de', '—', 'Tage')).toBe('14 Tage');
  });

  it('falls back without a unit for a missing value', () => {
    // Appending "Tage" to the fallback would read as "— Tage".
    expect(formatDays(null, 'de', '—', 'Tage')).toBe('—');
    expect(formatDays(undefined, 'de', '—', 'Tage')).toBe('—');
  });
});

describe('formatMetersAsCentimeters', () => {
  it('converts from the stored metres to the centimetres users think in', () => {
    expect(formatMetersAsCentimeters(0.25, 'de', '—')).toBe('25 cm');
  });

  it('rounds to a single decimal rather than showing float noise', () => {
    // 0.3334 m is 33.34 cm; anything beyond one decimal is spurious precision
    // for a bed measurement.
    expect(formatMetersAsCentimeters(0.3334, 'de', '—')).toBe('33,3 cm');
  });

  it('falls back without a unit for a missing value', () => {
    expect(formatMetersAsCentimeters(null, 'de', '—')).toBe('—');
  });

  it('converts zero rather than treating it as missing', () => {
    expect(formatMetersAsCentimeters(0, 'de', '—')).toBe('0 cm');
  });
});

describe('enum labels', () => {
  it('localizes each nutrient demand level', () => {
    expect(getNutrientDemandLabel('low', t, '—')).toBe('Niedrig');
    expect(getNutrientDemandLabel('medium', t, '—')).toBe('Mittel');
    expect(getNutrientDemandLabel('high', t, '—')).toBe('Hoch');
  });

  it('never renders an unknown demand value raw', () => {
    expect(getNutrientDemandLabel('enormous' as never, t, '—')).toBe('—');
    expect(getNutrientDemandLabel(null as never, t, '—')).toBe('—');
  });

  it('localizes each harvest method', () => {
    expect(getHarvestMethodLabel('per_plant', t, '—')).toBe('Pro Pflanze');
    expect(getHarvestMethodLabel('per_sqm', t, '—')).toBe('Pro m²');
  });

  it('never renders an unknown harvest method raw', () => {
    expect(getHarvestMethodLabel('per_hectare' as never, t, '—')).toBe('—');
  });
});

describe('getCultivationTypesLabel', () => {
  it('joins several types', () => {
    expect(getCultivationTypesLabel(
      crop({ cultivation_types: ['pre_cultivation', 'direct_sowing'] } as never), t, '—',
    )).toBe('Pflanzung, Direktsaat');
  });

  it('falls back to the singular legacy field when the list is empty', () => {
    // Older public crops carry `cultivation_type` rather than the array.
    expect(getCultivationTypesLabel(
      crop({ cultivation_types: [], cultivation_type: 'direct_sowing' } as never), t, '—',
    )).toBe('Direktsaat');
  });

  it('prefers the list over the legacy field when both exist', () => {
    expect(getCultivationTypesLabel(
      crop({ cultivation_types: ['pre_cultivation'], cultivation_type: 'direct_sowing' } as never), t, '—',
    )).toBe('Pflanzung');
  });

  it('falls back when neither is set', () => {
    expect(getCultivationTypesLabel(crop(), t, '—')).toBe('—');
  });

  it('spells pre_cultivation differently here than the publish wizard does', () => {
    // The detail page resolves `library.page.fields.cultivationTypes.preCultivation`
    // ("Pflanzung"); the publishing wizard's comparison resolves
    // `library.publishWizard.comparison.values.pre_cultivation` ("Vorkultur")
    // for the same stored enum value. Two German words for one thing,
    // depending on the surface. Pinned so the difference is visible.
    expect(getCultivationTypesLabel(
      crop({ cultivation_types: ['pre_cultivation'] } as never), t, '—',
    )).toBe('Pflanzung');
    expect(formatPublicCropValue('cultivation_types', ['pre_cultivation'], t)).toBe('Vorkultur');
  });

  it('falls back rather than rendering an empty join for unlabelled values', () => {
    expect(getCultivationTypesLabel(
      crop({ cultivation_types: ['hydroponic'] } as never), t, '—',
    )).toBe('—');
  });
});

describe('getPublicCropOriginalLanguageCode', () => {
  it('prefers the declared original language over the served one', () => {
    // Both codes have to be supported languages for the precedence to be
    // visible — an unsupported one normalizes to null and drops out silently.
    expect(getPublicCropOriginalLanguageCode(
      crop({ original_language_code: 'de', description_language_code: 'en' } as never), 'en',
    )).toBe('de');
  });

  it('falls back to the language the description was served in', () => {
    expect(getPublicCropOriginalLanguageCode(
      crop({ description_language_code: 'en' } as never), 'de',
    )).toBe('en');
  });

  it('then falls back to the current UI language', () => {
    expect(getPublicCropOriginalLanguageCode(crop(), 'en')).toBe('en');
  });

  it('lands on German only when nothing else resolves', () => {
    expect(getPublicCropOriginalLanguageCode(crop(), 'not-a-tag')).toBe('de');
  });

  it('discards a language the app does not support, rather than carrying it', () => {
    // normalizeLanguageTag only accepts the codes in SUPPORTED_LANGUAGES, so a
    // crop marked as French falls straight through to the next candidate.
    expect(getPublicCropOriginalLanguageCode(
      crop({ original_language_code: 'fr', description_language_code: 'en' } as never), 'de',
    )).toBe('en');
  });

  it('normalizes a regional tag down to its base language', () => {
    expect(getPublicCropOriginalLanguageCode(
      crop({ original_language_code: 'en-GB' } as never), 'de',
    )).toBe('en');
  });
});

describe('buildPublicCropDescriptionDrafts', () => {
  it('keeps the translations that are already there', () => {
    expect(buildPublicCropDescriptionDrafts(
      crop({ translations: { de: 'Hallo', en: 'Hello' } } as never),
    )).toMatchObject({ de: 'Hallo', en: 'Hello' });
  });

  it('adds the served description under its own language', () => {
    expect(buildPublicCropDescriptionDrafts(
      crop({ description_language_code: 'en', description: 'Hello', translations: {} } as never),
    )).toMatchObject({ en: 'Hello' });
  });

  it('does not overwrite an existing translation with the served description', () => {
    expect(buildPublicCropDescriptionDrafts(
      crop({ description_language_code: 'en', description: 'Served', translations: { en: 'Kept' } } as never),
    )).toMatchObject({ en: 'Kept' });
  });

  it('seeds the original language from the notes when nothing else covers it', () => {
    expect(buildPublicCropDescriptionDrafts(
      crop({ original_language_code: 'en', notes: 'Hello', translations: {} } as never),
    )).toMatchObject({ en: 'Hello' });
  });

  it('leaves the crop’s own translations object alone', () => {
    const translations = {};
    buildPublicCropDescriptionDrafts(
      crop({ description_language_code: 'en', description: 'Hello', translations } as never),
    );
    expect(translations).toEqual({});
  });
});

describe('getPublicCropFieldLabel', () => {
  it('localizes the fields it knows', () => {
    expect(getPublicCropFieldLabel('name', t)).toBe('Kulturart');
    expect(getPublicCropFieldLabel('variety', t)).toBe('Sorte');
  });

  it('shows the raw field name for one it does not', () => {
    // Not ideal, but better than an untranslated i18n key; recorded as-is.
    expect(getPublicCropFieldLabel('seed_rate_unit', t)).toBe('seed_rate_unit');
  });

  it('does not pass an unmapped field through the translator', () => {
    // `supplier_id` is also a top-level key in the crops namespace ("Lieferant").
    // Translating the raw field name would pull that unrelated label into a diff
    // row; the explicit map lookup is what prevents the collision.
    expect(t('supplier_id')).toBe('Lieferant');
    expect(getPublicCropFieldLabel('supplier_id', t)).toBe('supplier_id');
  });
});

describe('formatPublicCropValue', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['an empty array', []],
  ])('renders %s as the localized empty label', (_label, value) => {
    expect(formatPublicCropValue('notes', value, t)).toBe('Nicht angegeben');
  });

  it('renders booleans as Ja and Nein, never as true/false', () => {
    expect(formatPublicCropValue('needs_support', true, t)).toBe('Ja');
    expect(formatPublicCropValue('needs_support', false, t)).toBe('Nein');
  });

  it('localizes an enum value for the fields that carry one', () => {
    expect(formatPublicCropValue('nutrient_demand', 'high', t)).toBe('Hoch');
    expect(formatPublicCropValue('harvest_method', 'per_sqm', t)).toBe('Pro Quadratmeter');
  });

  it('leaves a plain text field unlocalized', () => {
    // 'high' is a real enum value elsewhere; on a text field it must be shown
    // verbatim rather than translated as if it were one.
    expect(formatPublicCropValue('variety', 'high', t)).toBe('high');
  });

  it('falls back to the raw value for an enum member with no translation', () => {
    expect(formatPublicCropValue('nutrient_demand', 'enormous', t)).toBe('enormous');
  });

  it('sorts an array before joining, so reordering alone is not a change', () => {
    expect(formatPublicCropValue('cultivation_types', ['pre_cultivation', 'direct_sowing'], t))
      .toBe(formatPublicCropValue('cultivation_types', ['direct_sowing', 'pre_cultivation'], t));
  });

  it('renders an object as JSON rather than as [object Object]', () => {
    expect(formatPublicCropValue('seed_packages', { size: 100 }, t)).toBe('{"size":100}');
  });

  it('renders false as Nein, not as the empty label', () => {
    // `false` is a real answer; treating it as unset would be wrong.
    expect(formatPublicCropValue('needs_support', false, t)).not.toBe('Nicht angegeben');
  });
});

describe('getRevisionValueLabel', () => {
  it('joins an array', () => {
    expect(getRevisionValueLabel(['a', 'b'], '—')).toBe('a, b');
  });

  it('serializes an object', () => {
    expect(getRevisionValueLabel({ a: 1 }, '—')).toBe('{"a":1}');
  });

  it('stringifies a primitive', () => {
    expect(getRevisionValueLabel(3, '—')).toBe('3');
    expect(getRevisionValueLabel(false, '—')).toBe('false');
  });

  it.each([['null', null], ['undefined', undefined], ['an empty string', '']])(
    'falls back for %s', (_label, value) => {
      expect(getRevisionValueLabel(value, '—')).toBe('—');
    },
  );

  it('renders an empty array as an empty string, not as the fallback', () => {
    // Unlike formatPublicCropValue, this one has no empty-array case — the
    // join simply produces ''. Recorded as the current difference.
    expect(getRevisionValueLabel([], '—')).toBe('');
  });
});

describe('isEmptyPublicValue', () => {
  it.each([['null', null], ['undefined', undefined], ['an empty string', ''], ['an empty array', []]])(
    'treats %s as empty', (_label, value) => {
      expect(isEmptyPublicValue(value)).toBe(true);
    },
  );

  it('does not treat zero or false as empty', () => {
    expect(isEmptyPublicValue(0)).toBe(false);
    expect(isEmptyPublicValue(false)).toBe(false);
  });
});

describe('arePublicValuesEqual', () => {
  it('treats two differently-shaped empties as equal', () => {
    // A field cleared to '' and one that was never set must not read as a
    // change worth publishing.
    expect(arePublicValuesEqual(null, '')).toBe(true);
    expect(arePublicValuesEqual([], undefined)).toBe(true);
  });

  it('compares numbers within floating-point tolerance', () => {
    expect(arePublicValuesEqual(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('still separates numbers that genuinely differ', () => {
    expect(arePublicValuesEqual(1, 1.0001)).toBe(false);
  });

  it('ignores array order, since these fields are sets', () => {
    expect(arePublicValuesEqual(['b', 'a'], ['a', 'b'])).toBe(true);
  });

  it('reports a real array difference', () => {
    expect(arePublicValuesEqual(['a'], ['a', 'b'])).toBe(false);
  });

  it('compares objects structurally', () => {
    expect(arePublicValuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(arePublicValuesEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('does not equate an array with a scalar of the same text', () => {
    expect(arePublicValuesEqual(['a'], 'a')).toBe(false);
  });

  it('compares primitives strictly, so 1 and "1" differ', () => {
    expect(arePublicValuesEqual(1, '1')).toBe(false);
  });

  it('is sensitive to key order for object arrays, which sort cannot fix', () => {
    // [...].sort() is a no-op on objects, so these fall through to
    // JSON.stringify — where key order matters. Documented, not endorsed.
    expect(arePublicValuesEqual([{ a: 1, b: 2 }], [{ b: 2, a: 1 }])).toBe(false);
  });
});
