import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { createSiteConditionColumns } from '../components/hierarchy/SiteConditionColumns';

describe('site-condition grid columns', () => {
  it('labels the moisture column briefly and explains it in the header tooltip', () => {
    const t = i18n.getFixedT('de');
    const columns = createSiteConditionColumns(t);
    const moisture = columns.find((column) => column.field === 'soil_moisture');

    expect(moisture?.headerName).toBe('Feuchtigkeit');
    expect(moisture?.description).toBe(
      'Wie feucht der Boden hier langfristig üblicherweise ist, nicht die aktuell gemessene Feuchtigkeit.',
    );
    // Only fields that need an explanation get a header tooltip.
    expect(columns.find((column) => column.field === 'light_condition')?.description).toBeUndefined();
  });
});
