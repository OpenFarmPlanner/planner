import { forwardRef, useId, type ElementType, type FocusEvent, type ReactNode, type Ref } from 'react';
import {
  Box,
  Divider,
  FormControl,
  FormHelperText,
  InputLabel,
  OutlinedInput,
  type InputBaseComponentProps,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

import { useLocalizedDecimalInput } from './useLocalizedDecimalInput';

type RangeValue = number | string | null | undefined;

/** One end of a range. */
export interface RangeFieldBound {
  /** API decimals may arrive as strings (e.g. "4.50"). */
  value: RangeValue;
  /** Receives the parsed number, or null when the input was cleared. */
  onValueChange: (value: number | null) => void;
  /** The input's own accessible name, e.g. "Sowing depth from (cm)". */
  ariaLabel: string;
  /** Usually "From" / "To". */
  placeholder?: string;
  /** Rendered right after the input inside the field, e.g. a library pin button. */
  adornment?: ReactNode;
}

export interface RangeFieldProps {
  /** The visible label in the border; it also names the group. */
  label: string;
  from: RangeFieldBound;
  to: RangeFieldBound;
  /** `decimal` accepts the UI language's decimal separator; `integer` is a whole-number input. */
  numberKind?: 'decimal' | 'integer';
  /** A validation error for either bound; shown instead of `invalidRangeText`. */
  error?: string;
  /** Shown below the field while From is greater than To. */
  invalidRangeText: string;
  sx?: SxProps<Theme>;
}

interface RangeInputsProps extends InputBaseComponentProps {
  bounds: { from: RangeFieldBound; to: RangeFieldBound };
  numberKind: 'decimal' | 'integer';
}

interface BoundInputProps {
  bound: RangeFieldBound;
  className?: string;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  id?: string;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
}

function toNumber(value: RangeValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Whether both bounds hold a number and From is greater than To. */
function isReversedRange(from: RangeValue, to: RangeValue): boolean {
  const fromNumber = toNumber(from);
  const toNumberValue = toNumber(to);
  return fromNumber !== null && toNumberValue !== null && fromNumber > toNumberValue;
}

function DecimalBoundInput({ bound, inputRef, ariaInvalid, ariaDescribedBy, onBlur, ...inputProps }: BoundInputProps) {
  const input = useLocalizedDecimalInput({ value: bound.value, onValueChange: bound.onValueChange });
  return (
    <input
      {...inputProps}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      aria-label={bound.ariaLabel}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      placeholder={bound.placeholder}
      value={input.value}
      onChange={(event) => input.onChange(event.target.value)}
      onBlur={(event) => {
        input.onBlur();
        onBlur?.(event);
      }}
    />
  );
}

function IntegerBoundInput({ bound, inputRef, ariaInvalid, ariaDescribedBy, ...inputProps }: BoundInputProps) {
  return (
    <input
      {...inputProps}
      ref={inputRef}
      type="number"
      inputMode="numeric"
      min={0}
      step={1}
      aria-label={bound.ariaLabel}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      placeholder={bound.placeholder}
      value={bound.value ?? ''}
      onChange={(event) => bound.onValueChange(event.target.value === '' ? null : Number(event.target.value))}
    />
  );
}

/**
 * The two inputs inside the outlined field, rendered as the `OutlinedInput`'s
 * input component: both carry the outlined input's class (padding, font) and
 * report focus to the `FormControl`, so the border, label colour and focus
 * ring behave exactly like a single-input field.
 */
const RangeInputs = forwardRef<HTMLInputElement, RangeInputsProps>(function RangeInputs(
  {
    bounds,
    numberKind,
    className,
    disabled,
    onFocus,
    onBlur,
    id,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
  },
  ref,
) {
  const BoundInput = numberKind === 'integer' ? IntegerBoundInput : DecimalBoundInput;
  const shared = {
    className,
    disabled,
    ariaInvalid: ariaInvalid === true || ariaInvalid === 'true',
    ariaDescribedBy,
    onFocus: onFocus as BoundInputProps['onFocus'],
    onBlur: onBlur as BoundInputProps['onBlur'],
  };
  const adornment = (node: ReactNode) => (
    node ? <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0, pr: 1 }}>{node}</Box> : null
  );
  return (
    <>
      <BoundInput {...shared} bound={bounds.from} id={id} inputRef={ref} />
      {adornment(bounds.from.adornment)}
      <Divider orientation="vertical" flexItem aria-hidden sx={{ my: 1 }} />
      <BoundInput {...shared} bound={bounds.to} />
      {adornment(bounds.to.adornment)}
    </>
  );
});

/**
 * A from/to range as one outlined field: the label sits in the border and
 * names the group, the two inputs share the field, separated by a thin
 * divider, and each has its own accessible name. Height, border, focus and
 * error state are the outlined field's own. An error, or From greater than
 * To, shows inline below the field.
 */
export function RangeField({
  label,
  from,
  to,
  numberKind = 'decimal',
  error,
  invalidRangeText,
  sx,
}: RangeFieldProps) {
  const labelId = useId();
  const helperId = useId();
  const helperText = error || (isReversedRange(from.value, to.value) ? invalidRangeText : undefined);

  return (
    <FormControl
      sx={sx}
      error={Boolean(helperText)}
      role="group"
      aria-labelledby={labelId}
      data-testid="range-field"
    >
      <InputLabel id={labelId} shrink>{label}</InputLabel>
      <OutlinedInput
        label={label}
        notched
        // The inputs hold their own values; the field itself stays controlled and empty.
        value=""
        inputComponent={RangeInputs as unknown as ElementType<InputBaseComponentProps>}
        inputProps={{
          bounds: { from, to },
          numberKind,
          'aria-describedby': helperText ? helperId : undefined,
        }}
      />
      {helperText ? <FormHelperText id={helperId}>{helperText}</FormHelperText> : null}
    </FormControl>
  );
}
