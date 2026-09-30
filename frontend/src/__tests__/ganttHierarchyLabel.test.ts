import { describe, expect, it } from 'vitest';
import type { TaskGroup } from '../gantt-chart/src/types';
import {
  TREE_INDENT_PX,
  estimateLabelHeight,
  estimateTaskGroupLabelHeight,
  getHierarchyLevels,
  getLabelLinesSource,
  normalizeLeftColumnWidth,
} from '../gantt-chart/src/utils/hierarchyLabel';

const group = (partial: Partial<TaskGroup> = {}): TaskGroup => ({
  id: 'g1',
  name: '',
  tasks: [],
  ...partial,
});

/**
 * The left column's label resolution and its row-height estimate. Both are
 * shared by `TaskList` (the left column) and `TaskRow` (the timeline row) so a
 * row never ends up a different height on the two sides of the chart -- a
 * divergence that caused a real sidebar/timeline misalignment once, which is
 * why the estimate's arithmetic is pinned here down to the pixel rather than
 * just "roughly this tall".
 *
 * A mutation battery leaves eight breaks standing, and each one is redundant
 * code rather than a hole in this suite. Recorded so the next reader does not
 * spend the same afternoon on them:
 *
 * - `description.trim()` and `parts.map((part) => part.trim())` are mutually
 *   redundant. Every consumer of the outer trim trims again, and every part the
 *   separators produce is already clean because the outer trim ran -- so
 *   removing either one alone changes nothing, and only removing both would.
 *   The blank-description guard is the same: falling through it also ends in
 *   `null`.
 * - `metadataLevels.length >= 2` can be raised to 3 without effect. A two-level
 *   metadata row falls through to `getParsedHierarchy`, whose explicit branch
 *   reads the very same three fields and reaches the same answer.
 * - `normalizeLeftColumnWidth` inside `estimateLabelHeight` cannot change the
 *   result. Below 96px both the normalized and the raw width land on the
 *   12-character floor, and above it `Math.floor` on the division already
 *   absorbs the fractional part -- there is no width where the two differ.
 * - `Math.max(1, Math.ceil(...))` never needs its floor: the blank-label guard
 *   above it means the length is at least 1, so the ceiling already is.
 * - `isTreeRow ? null : getHierarchyLevels(...)` only avoids wasted work; a tree
 *   row never reads the levels either way.
 * - `(taskGroup.depth ?? 0)` never falls back, because a row only counts as a
 *   tree row once `depth` is defined.
 */
describe('getHierarchyLevels', () => {
  describe('from an explicit hierarchyPath', () => {
    it('takes the path as given once it has two levels', () => {
      expect(getHierarchyLevels(group({ hierarchyPath: ['Hof', 'Nordfeld'] }))).toEqual([
        'Hof',
        'Nordfeld',
      ]);
    });

    it('keeps a third level', () => {
      expect(
        getHierarchyLevels(group({ hierarchyPath: ['Hof', 'Nordfeld', 'Beet A'] })),
      ).toEqual(['Hof', 'Nordfeld', 'Beet A']);
    });

    it('trims each level and drops the blank ones', () => {
      expect(
        getHierarchyLevels(group({ hierarchyPath: ['  Hof  ', '   ', ' Nordfeld'] })),
      ).toEqual(['Hof', 'Nordfeld']);
    });

    it('ignores a path that is left with a single level, and falls back', () => {
      expect(
        getHierarchyLevels(
          group({
            hierarchyPath: ['Hof', '  '],
            locationName: 'Gärtnerei',
            fieldName: 'Südfeld',
          }),
        ),
      ).toEqual(['Gärtnerei', 'Südfeld', 'Unnamed']);
    });

    it('ignores a path that is not an array at all', () => {
      expect(
        getHierarchyLevels(
          group({
            hierarchyPath: 'Hof > Nordfeld' as unknown as string[],
            locationName: 'Gärtnerei',
            fieldName: 'Südfeld',
          }),
        ),
      ).toEqual(['Gärtnerei', 'Südfeld', 'Unnamed']);
    });
  });

  describe('from the flat metadata fields', () => {
    it('reads location, field and bed in that order', () => {
      expect(
        getHierarchyLevels(
          group({ locationName: 'Hof', fieldName: 'Nordfeld', bedName: 'Beet A' }),
        ),
      ).toEqual(['Hof', 'Nordfeld', 'Beet A']);
    });

    it('prefers the group name over the bed name for the last level', () => {
      expect(
        getHierarchyLevels(
          group({
            name: 'Beet A (Karotte)',
            locationName: 'Hof',
            fieldName: 'Nordfeld',
            bedName: 'Beet A',
          }),
        ),
      ).toEqual(['Hof', 'Nordfeld', 'Beet A (Karotte)']);
    });

    it('falls back to "Unnamed" when neither a name nor a bed is known', () => {
      expect(getHierarchyLevels(group({ locationName: 'Hof', fieldName: 'Nordfeld' }))).toEqual([
        'Hof',
        'Nordfeld',
        'Unnamed',
      ]);
    });

    /**
     * A whitespace-only name still wins the `||` chain, so it shadows the bed
     * name and is then dropped by the trim filter -- the row loses its last
     * level rather than showing the bed.
     */
    it('lets a whitespace-only name shadow the bed name and then drop out', () => {
      expect(
        getHierarchyLevels(
          group({ name: '   ', locationName: 'Hof', fieldName: 'Nordfeld', bedName: 'Beet A' }),
        ),
      ).toEqual(['Hof', 'Nordfeld']);
    });

    it('works with a location and a name but no field', () => {
      expect(getHierarchyLevels(group({ name: 'Beet A', locationName: 'Hof' }))).toEqual([
        'Hof',
        'Beet A',
      ]);
    });

    it('is not satisfied by the "Unnamed" fallback alone', () => {
      expect(getHierarchyLevels(group())).toBeNull();
    });
  });

  describe('from a parsed description', () => {
    it('reads one level per line when the description is multi-line', () => {
      expect(
        getHierarchyLevels(group({ description: 'Hof\nNordfeld\nBeet A' })),
      ).toEqual(['Hof', 'Nordfeld', 'Beet A']);
    });

    it('trims the lines and drops the empty ones', () => {
      expect(
        getHierarchyLevels(group({ description: '  Hof  \n\n  Nordfeld  \n' })),
      ).toEqual(['Hof', 'Nordfeld', 'Unnamed']);
    });

    it('ignores lines beyond the third', () => {
      expect(
        getHierarchyLevels(group({ description: 'Hof\nNordfeld\nBeet A\nZeile 4' })),
      ).toEqual(['Hof', 'Nordfeld', 'Beet A']);
    });

    it.each([
      ['a chevron', 'Hof > Nordfeld > Beet A'],
      ['a single guillemet', 'Hof › Nordfeld › Beet A'],
      ['an arrow', 'Hof → Nordfeld → Beet A'],
      ['a pipe', 'Hof | Nordfeld | Beet A'],
      ['a slash', 'Hof / Nordfeld / Beet A'],
    ])('splits a single line on %s', (_label, description) => {
      expect(getHierarchyLevels(group({ description }))).toEqual(['Hof', 'Nordfeld', 'Beet A']);
    });

    it('accepts a separator with no surrounding spaces', () => {
      expect(getHierarchyLevels(group({ description: 'Hof>Nordfeld' }))).toEqual([
        'Hof',
        'Nordfeld',
        'Unnamed',
      ]);
    });

    /**
     * The ASCII-arrow separator is listed but can never be reached: the
     * chevron pattern is tried first and matches the `>` inside `->`, so the
     * hyphen stays glued to the level before it. A description written with
     * ASCII arrows renders as "Hof -" rather than "Hof". Pinned as the current
     * behaviour, not endorsed -- fixing it means reordering the patterns or
     * anchoring the chevron, which is its own change.
     */
    it('leaves the hyphen of an ASCII arrow on the preceding level', () => {
      expect(getHierarchyLevels(group({ description: 'Hof -> Nordfeld' }))).toEqual([
        'Hof -',
        'Nordfeld',
        'Unnamed',
      ]);
    });

    it('prefers the first separator that yields a complete split', () => {
      expect(getHierarchyLevels(group({ description: 'Hof/Gut > Nordfeld' }))).toEqual([
        'Hof/Gut',
        'Nordfeld',
        'Unnamed',
      ]);
    });

    it('moves on from a separator that leaves an empty part', () => {
      expect(getHierarchyLevels(group({ description: 'Hof > > Nordfeld / Beet A' }))).toEqual([
        'Hof > > Nordfeld',
        'Beet A',
        'Unnamed',
      ]);
    });

    it('still prefers the group name over a parsed bed name', () => {
      expect(
        getHierarchyLevels(group({ name: 'Beet B', description: 'Hof > Nordfeld > Beet A' })),
      ).toEqual(['Hof', 'Nordfeld', 'Beet B']);
    });

    /**
     * A whitespace-only `locationName` is enough to take `getParsedHierarchy`'s
     * explicit branch, which then contributes nothing after the trim filter --
     * so the description is never looked at and the row loses a hierarchy it
     * could have had. Pinned as the current behaviour; the fix is a trim in
     * `getParsedHierarchy`, which is its own change.
     */
    it('lets a whitespace-only location shadow a description it could have parsed', () => {
      expect(
        getHierarchyLevels(group({ locationName: '   ', description: 'Hof > Nordfeld' })),
      ).toBeNull();
    });

    it('rejects a hierarchy that collapses to a single level', () => {
      expect(getHierarchyLevels(group({ locationName: '   ' }))).toBeNull();
      expect(getHierarchyLevels(group({ fieldName: '   ', name: 'Beet A' }))).toBeNull();
    });

    it.each([
      ['no description', undefined],
      ['an empty description', ''],
      ['a whitespace-only description', '   \n  '],
      ['a description with no separator', 'Nordfeld'],
      ['a description whose every separator leaves a gap', 'Hof > > Nordfeld'],
    ])('gives up on %s', (_label, description) => {
      expect(getHierarchyLevels(group({ description }))).toBeNull();
    });
  });
});

describe('normalizeLeftColumnWidth', () => {
  it('passes a usable width through', () => {
    expect(normalizeLeftColumnWidth(240)).toBe(240);
  });

  it('floors a fractional width', () => {
    expect(normalizeLeftColumnWidth(240.9)).toBe(240);
  });

  it.each([
    ['just below the floor', 95, 96],
    ['exactly the floor', 96, 96],
    ['a fraction above the floor', 96.9, 96],
    ['zero', 0, 96],
    ['a negative width', -200, 96],
  ])('clamps %s to 96', (_label, input, expected) => {
    expect(normalizeLeftColumnWidth(input)).toBe(expected);
  });
});

describe('estimateLabelHeight', () => {
  it('never goes below the single-row floor', () => {
    expect(estimateLabelHeight(['Hof'], 300)).toBe(40);
  });

  it('treats a label with no content as no line at all', () => {
    expect(estimateLabelHeight(['', '   '], 300)).toBe(40);
    expect(estimateLabelHeight([], 300)).toBe(40);
  });

  /**
   * 39 characters fit per line at a width of 300, so 40 characters wrap to two
   * lines: 2 * 16 + 20.
   */
  it('grows by one 16px line per wrapped line', () => {
    expect(estimateLabelHeight(['x'.repeat(40)], 300)).toBe(52);
    expect(estimateLabelHeight(['x'.repeat(78)], 300)).toBe(52);
    expect(estimateLabelHeight(['x'.repeat(79)], 300)).toBe(68);
  });

  it('adds up the lines of several labels', () => {
    expect(estimateLabelHeight(['Hof', 'Nordfeld', 'Beet A'], 300)).toBe(68);
  });

  it('skips the blank labels between real ones', () => {
    expect(estimateLabelHeight(['Hof', '  ', 'Nordfeld'], 300)).toBe(52);
  });

  it('measures the trimmed label, not the padding around it', () => {
    expect(estimateLabelHeight([`${' '.repeat(40)}Hof`], 300)).toBe(40);
  });

  it('fits fewer characters per line in a narrower column', () => {
    expect(estimateLabelHeight(['x'.repeat(26)], 200)).toBe(52);
    expect(estimateLabelHeight(['x'.repeat(25)], 200)).toBe(40);
  });

  /**
   * At the 96px floor the formula would allow 10 characters per line, but it
   * never assumes fewer than 12 -- otherwise a narrow column would inflate
   * every row.
   */
  it('never assumes fewer than 12 characters per line', () => {
    expect(estimateLabelHeight(['x'.repeat(12)], 96)).toBe(40);
    expect(estimateLabelHeight(['x'.repeat(13)], 96)).toBe(52);
  });

  it('normalizes the width it was handed', () => {
    expect(estimateLabelHeight(['x'.repeat(13)], 10)).toBe(estimateLabelHeight(['x'.repeat(13)], 96));
  });
});

describe('getLabelLinesSource', () => {
  it('uses the hierarchy levels when there are any', () => {
    expect(getLabelLinesSource(group({ name: 'Beet A' }), ['Hof', 'Nordfeld'])).toEqual([
      'Hof',
      'Nordfeld',
    ]);
  });

  /**
   * An empty array is still a resolved hierarchy, so it wins over the name --
   * `getHierarchyLevels` returns `null` rather than `[]` when it finds nothing,
   * which is what keeps this from swallowing the name in practice.
   */
  it('prefers an empty hierarchy over the name', () => {
    expect(getLabelLinesSource(group({ name: 'Beet A' }), [])).toEqual([]);
  });

  it('falls back to the name and the description', () => {
    expect(
      getLabelLinesSource(group({ name: 'Beet A', description: 'Karotte, Nantaise' }), null),
    ).toEqual(['Beet A', 'Karotte, Nantaise']);
  });

  it('leaves out a description it was told to ignore', () => {
    expect(
      getLabelLinesSource(group({ name: 'Beet A', description: 'Karotte' }), null, false),
    ).toEqual(['Beet A']);
  });

  it('includes the description by default', () => {
    expect(getLabelLinesSource(group({ name: 'Beet A', description: 'Karotte' }), null)).toEqual([
      'Beet A',
      'Karotte',
    ]);
  });

  it('drops a missing description rather than counting an empty line', () => {
    expect(getLabelLinesSource(group({ name: 'Beet A' }), null)).toEqual(['Beet A']);
  });

  it('names an unnamed group', () => {
    expect(getLabelLinesSource(group(), null)).toEqual(['Unnamed']);
  });
});

describe('estimateTaskGroupLabelHeight', () => {
  it('measures a flat row from its hierarchy levels', () => {
    const flat = group({ locationName: 'Hof', fieldName: 'Nordfeld', bedName: 'Beet A' });
    expect(estimateTaskGroupLabelHeight(flat, 300)).toBe(68);
  });

  it('measures a flat row without a hierarchy from its name and description', () => {
    const flat = group({ name: 'Beet A', description: 'Karotte' });
    expect(estimateTaskGroupLabelHeight(flat, 300)).toBe(52);
  });

  it('leaves the description out when asked to', () => {
    const flat = group({ name: 'Beet A', description: 'Karotte' });
    expect(estimateTaskGroupLabelHeight(flat, 300, { includeDescription: false })).toBe(40);
  });

  describe('tree rows', () => {
    /**
     * A tree row is any group that carries a `depth`, including depth 0, and it
     * shows only its own name: the hierarchy is already expressed by the tree
     * itself, so re-rendering it in the label would duplicate it.
     */
    it('ignores the hierarchy a tree row also carries', () => {
      const tree = group({
        name: 'Beet A',
        depth: 0,
        hierarchyPath: ['Hof', 'Nordfeld', 'Beet A'],
        description: 'Karotte',
      });
      expect(estimateTaskGroupLabelHeight(tree, 300)).toBe(40);
    });

    it('treats depth 0 as a tree row, not as no depth', () => {
      const withDepth = group({ name: 'x'.repeat(40), depth: 0, description: 'x'.repeat(40) });
      const withoutDepth = group({ name: 'x'.repeat(40), description: 'x'.repeat(40) });
      expect(estimateTaskGroupLabelHeight(withDepth, 300)).toBe(52);
      expect(estimateTaskGroupLabelHeight(withoutDepth, 300)).toBe(84);
    });

    /**
     * Indentation eats into the width a label has left, so a deeper row wraps
     * sooner. This is the part `TaskRow` once missed while `TaskList` applied
     * it, which is exactly how the two sides drifted apart.
     */
    it('subtracts the indent of each depth level from the available width', () => {
      const deep = group({ name: 'x'.repeat(17), depth: 3 });
      expect(estimateTaskGroupLabelHeight(deep, 200)).toBe(52);
      expect(estimateTaskGroupLabelHeight(group({ name: 'x'.repeat(17) }), 200)).toBe(40);
    });

    it('indents by 20px per level', () => {
      expect(TREE_INDENT_PX).toBe(20);
      const deep = group({ name: 'x'.repeat(17), depth: 3 });
      expect(estimateTaskGroupLabelHeight(deep, 200)).toBe(
        estimateLabelHeight(['x'.repeat(17)], 200 - 3 * TREE_INDENT_PX),
      );
    });

    it('still clamps the indented width to the 96px floor', () => {
      const veryDeep = group({ name: 'x'.repeat(13), depth: 20 });
      expect(estimateTaskGroupLabelHeight(veryDeep, 200)).toBe(52);
    });

    it('names an unnamed tree row', () => {
      expect(estimateTaskGroupLabelHeight(group({ depth: 1 }), 300)).toBe(40);
    });
  });
});
