import { render, screen } from '@testing-library/react';
import type { GridColDef } from '@mui/x-data-grid';
import {
  createSearchableSelectColumn,
  createSingleSelectColumn,
} from '../components/data-grid/columns';

interface Row extends Record<string, unknown> {
  id: number;
  supplier_id: number;
  name: string;
}

const OPTIONS = [
  { value: 1, label: 'Bingenheimer' },
  { value: 2, label: 'Sativa' },
];

const config = (overrides: Record<string, unknown> = {}) => ({
  field: 'supplier_id' as keyof Row,
  headerName: 'Lieferant',
  flex: 1,
  minWidth: 120,
  options: OPTIONS,
  ...overrides,
});

/** The two builders differ only in which edit cell they render, so every
 * behaviour below is asserted against both. */
const builders: [string, (c: ReturnType<typeof config>) => GridColDef][] = [
  ['createSearchableSelectColumn', createSearchableSelectColumn<Row>],
  ['createSingleSelectColumn', createSingleSelectColumn<Row>],
];

describe.each(builders)('%s', (_name, build) => {
  const column = () => build(config());
  const format = (value: unknown) =>
    // The formatter only reads its first argument.
    (column().valueFormatter as (v: unknown, ...rest: unknown[]) => string)(value);

  describe('the column definition', () => {
    it('carries the layout and select configuration through', () => {
      expect(build(config({ maxWidth: 300 }))).toMatchObject({
        field: 'supplier_id',
        headerName: 'Lieferant',
        flex: 1,
        minWidth: 120,
        maxWidth: 300,
        editable: true,
        type: 'singleSelect',
        valueOptions: OPTIONS,
      });
    });

    it('stringifies the field, since the grid keys columns by string', () => {
      expect(typeof build(config()).field).toBe('string');
    });
  });

  describe('valueFormatter', () => {
    it('shows the option label for a stored id', () => {
      expect(format(1)).toBe('Bingenheimer');
      expect(format(2)).toBe('Sativa');
    });

    it('accepts a numeric string, because the grid may hand one back', () => {
      expect(format('2')).toBe('Sativa');
    });

    it('renders an empty cell rather than a raw id when nothing matches', () => {
      // Showing "7" to a user who expects a supplier name would be worse than
      // showing nothing.
      expect(format(7)).toBe('');
    });

    it('renders an empty cell for an unset value', () => {
      expect(format(null)).toBe('');
      expect(format(undefined)).toBe('');
    });

    it('renders an empty cell for a value that is not a number at all', () => {
      expect(format('Bingenheimer')).toBe('');
      expect(format(Number.NaN)).toBe('');
      expect(format({})).toBe('');
    });

    it('keeps an unset value unset even when an option carries the id 0', () => {
      // Without the null/undefined guard, `Number(null)` is 0 and would match
      // such an option — labelling an empty cell as a real selection. With the
      // ordinary options the guard is masked by the lookup missing anyway, so
      // this configuration is what makes it observable.
      const withZero = build(config({
        options: [{ value: 0, label: 'Ohne Lieferant' }, ...OPTIONS],
      }));
      const formatZero = withZero.valueFormatter as (v: unknown, ...rest: unknown[]) => string;

      expect(formatZero(0)).toBe('Ohne Lieferant');
      expect(formatZero(null)).toBe('');
      expect(formatZero(undefined)).toBe('');
      // The guard names null and undefined only: an empty string is not
      // caught, and `Number('')` is 0, so it resolves to the zero option.
      // Latent today, since no column configures one.
      expect(formatZero('')).toBe('Ohne Lieferant');
    });

    it('keeps an infinite value unset even when an option carries that id', () => {
      // The finiteness guard is far harder to observe than the null one. NaN
      // never equals itself, so a NaN cell value misses the lookup with or
      // without the guard, and a NaN-valued option is unmatchable for the same
      // reason. The single configuration in which the guard changes the answer
      // is an infinite value against an infinite option id — so that is what
      // this pins. It is defence rather than a case any column produces.
      const withInfinite = build(config({
        options: [{ value: Number.POSITIVE_INFINITY, label: 'Unendlich' }, ...OPTIONS],
      }));
      const formatInfinite = withInfinite.valueFormatter as (v: unknown, ...rest: unknown[]) => string;

      expect(formatInfinite(Number.POSITIVE_INFINITY)).toBe('');
      expect(formatInfinite('Infinity')).toBe('');
      expect(formatInfinite(1)).toBe('Bingenheimer');
    });
  });

  describe('valueSetter', () => {
    const set = (value: unknown, row: Row) =>
      (column().valueSetter as (v: unknown, r: Row, ...rest: unknown[]) => Row)(value, row);

    const row: Row = { id: 9, supplier_id: 1, name: 'Tomate' };

    it('stores the id as a number', () => {
      expect(set(2, row).supplier_id).toBe(2);
      expect(set('2', row).supplier_id).toBe(2);
    });

    it('leaves the rest of the row untouched', () => {
      expect(set(2, row)).toEqual({ id: 9, supplier_id: 2, name: 'Tomate' });
    });

    it('does not mutate the row it was given', () => {
      set(2, row);

      expect(row.supplier_id).toBe(1);
    });

    it('writes under the configured field, not a fixed key', () => {
      const other = build(config({ field: 'crop_id' as keyof Row }));
      const setter = other.valueSetter as (v: unknown, r: Row, ...rest: unknown[]) => Row;

      expect(setter(3, row)).toMatchObject({ crop_id: 3, supplier_id: 1 });
    });
  });

  describe('preProcessEditCellProps', () => {
    const validate = (value: unknown) =>
      (column().preProcessEditCellProps as (p: { props: { value: unknown } }) => { error: boolean })(
        { props: { value } },
      );

    it('accepts a real selection', () => {
      expect(validate(1).error).toBe(false);
    });

    it('rejects an empty selection', () => {
      expect(validate(null).error).toBe(true);
      expect(validate(undefined).error).toBe(true);
      expect(validate('').error).toBe(true);
    });

    it('rejects zero, which is the "nothing chosen" sentinel rather than an id', () => {
      expect(validate(0).error).toBe(true);
    });

    it('keeps the other edit-cell props alongside the error flag', () => {
      const process = column().preProcessEditCellProps as (
        params: { props: Record<string, unknown> },
      ) => Record<string, unknown>;

      expect(process({ props: { value: 1, isProcessingProps: true } }))
        .toMatchObject({ value: 1, isProcessingProps: true, error: false });
    });
  });

  describe('renderCell', () => {
    const renderWith = (col: GridColDef, formattedValue: unknown) => {
      const renderer = col.renderCell as (params: { formattedValue: unknown }) => React.ReactNode;
      return renderer({ formattedValue });
    };

    it('returns the formatted text directly when truncation is off', () => {
      expect(renderWith(build(config()), 'Bingenheimer')).toBe('Bingenheimer');
    });

    it('wraps the text for truncation when asked to', () => {
      render(<>{renderWith(build(config({ truncateCellText: true })), 'Bingenheimer')}</>);

      expect(screen.getByText('Bingenheimer')).toBeInTheDocument();
    });

    it('renders an empty wrapper rather than "null" for a missing value', () => {
      const { container } = render(
        <>{renderWith(build(config({ truncateCellText: true })), null)}</>,
      );

      expect(container.textContent).toBe('');
    });
  });
});
