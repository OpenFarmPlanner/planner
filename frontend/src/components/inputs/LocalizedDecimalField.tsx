import { forwardRef } from 'react';
import type { FocusEvent } from 'react';
import { TextField } from '@mui/material';
import type { TextFieldProps } from '@mui/material';
import { useLocalizedDecimalInput } from './useLocalizedDecimalInput';

export type LocalizedDecimalFieldProps = Omit<TextFieldProps, 'type' | 'value' | 'onChange' | 'defaultValue'> & {
  /** API decimals may arrive as strings (e.g. "4.50"); they are shown localized too. */
  value: number | string | null | undefined;
  /** Receives the parsed number, or null when the field was cleared. Unparseable drafts are not reported. */
  onValueChange: (value: number | null) => void;
  inputMode?: 'decimal' | 'numeric';
};

/**
 * A decimal input that shows the UI language's decimal separator in every
 * browser. A native `type="number"` input is formatted by the browser engine
 * instead (WebKit shows "0,5" under German, Chromium and Firefox "0.5"), so
 * the same value looked different per browser and differed from the comma used
 * everywhere else in the UI. Both "," and "." are accepted while typing.
 */
export const LocalizedDecimalField = forwardRef<HTMLDivElement, LocalizedDecimalFieldProps>(
  function LocalizedDecimalField({ value, onValueChange, inputMode = 'decimal', onBlur, slotProps, ...textFieldProps }, ref) {
    const input = useLocalizedDecimalInput({ value, onValueChange });

    return (
      <TextField
        ref={ref}
        {...textFieldProps}
        type="text"
        value={input.value}
        onChange={(event) => input.onChange(event.target.value)}
        onBlur={(event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          input.onBlur();
          onBlur?.(event);
        }}
        slotProps={{
          ...slotProps,
          htmlInput: { inputMode, ...(slotProps?.htmlInput as object | undefined) },
        }}
      />
    );
  },
);
