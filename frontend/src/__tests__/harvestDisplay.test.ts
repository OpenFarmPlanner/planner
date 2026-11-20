import { describe, expect, it } from 'vitest';
import i18n from '../i18n/config';
import { formatHarvestQuantity, formatHarvestTotals } from '../harvests/harvestDisplay';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';

describe('harvest quantities', () => {
  it.each([
    ['de', '1 Stück', '2 Stück', '1 Bund', '2 Bunde'],
    ['en', '1 piece', '2 pieces', '1 bunch', '2 bunches'],
    ['es', '1 pieza', '2 piezas', '1 manojo', '2 manojos'],
    ['fr', '1 pièce', '2 pièces', '1 botte', '2 bottes'],
    ['it', '1 pezzo', '2 pezzi', '1 mazzo', '2 mazzi'],
    ['pt', '1 unidade', '2 unidades', '1 molho', '2 molhos'],
    ['nl', '1 stuk', '2 stuks', '1 bos', '2 bossen'],
  ])('formats count and bundle units in %s', async (language, piece, pieces, bunch, bunches) => {
    await i18n.loadLanguages(language);
    const t = i18n.getFixedT(language, 'harvests');
    const locale = resolveLocaleFromLanguage(language);
    expect(formatHarvestQuantity('1', 'piece', locale, t)).toBe(piece);
    expect(formatHarvestQuantity('2', 'piece', locale, t)).toBe(pieces);
    expect(formatHarvestQuantity('1', 'bunch', locale, t)).toBe(bunch);
    expect(formatHarvestQuantity('2', 'bunch', locale, t)).toBe(bunches);
    expect(formatHarvestQuantity('1.125', 'kg', locale, t)).toMatch(/^1[.,]125\s*kg$/);
    expect(formatHarvestQuantity('125', 'g', locale, t)).toMatch(/^125\s*g$/);
    expect(formatHarvestTotals([
      { unit: 'kg', quantity: '1.125' }, { unit: 'piece', quantity: '2' },
    ], locale, t)).toBe(`${formatHarvestQuantity('1.125', 'kg', locale, t)} + ${pieces}`);
    expect(formatHarvestTotals([], locale, t)).toBe('');
  });
});
