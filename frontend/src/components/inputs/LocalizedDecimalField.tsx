import { forwardRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { TextField } from '@mui/material';
import type { TextFieldProps } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  formatLocalizedNumberForInput,
  parseLocalizedNumber,
  resolveLocaleFromLanguage,
} from '../../utils/numberLocalization';

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
    const { i18n } = useTranslation();
    const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
    // While the user types, their exact text is shown (e.g. "0," on the way to
    // "0,5"); the formatted value takes over again on blur.
    const [draft, setDraft] = useState<string | null>(null);

    const numericValue = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    const formattedValue = typeof numericValue === 'number' && Number.isFinite(numericValue)
      ? formatLocalizedNumberForInput(numericValue, locale)
      : '';

    return (
      <TextField
        ref={ref}
        {...textFieldProps}
        type="text"
        value={draft ?? formattedValue}
        onChange={(event) => {
          const rawValue = event.target.value;
          setDraft(rawValue);
          if (rawValue.trim() === '') {
            onValueChange(null);
            return;
          }
          const parsed = parseLocalizedNumber(rawValue, locale);
          if (parsed !== null) {
            onValueChange(parsed);
          }
        }}
        onBlur={(event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          setDraft(null);
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
