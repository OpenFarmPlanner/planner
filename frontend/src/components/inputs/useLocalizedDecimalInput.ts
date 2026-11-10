import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatLocalizedNumberForInput,
  parseLocalizedNumber,
  resolveLocaleFromLanguage,
} from '../../utils/numberLocalization';

interface LocalizedDecimalInputOptions {
  value: number | string | null | undefined;
  onValueChange: (value: number | null) => void;
}

/**
 * The text, change and blur handling behind `LocalizedDecimalField`, for an
 * input that is not a whole `TextField` (e.g. one bound of `RangeField`).
 */
export function useLocalizedDecimalInput({ value, onValueChange }: LocalizedDecimalInputOptions) {
  const { i18n } = useTranslation();
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  // While the user types, their exact text is shown (e.g. "0," on the way to
  // "0,5"); the formatted value takes over again on blur.
  const [draft, setDraft] = useState<string | null>(null);

  const numericValue = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  const formattedValue = typeof numericValue === 'number' && Number.isFinite(numericValue)
    ? formatLocalizedNumberForInput(numericValue, locale)
    : '';

  return {
    value: draft ?? formattedValue,
    onChange: (rawValue: string) => {
      setDraft(rawValue);
      if (rawValue.trim() === '') {
        onValueChange(null);
        return;
      }
      const parsed = parseLocalizedNumber(rawValue, locale);
      if (parsed !== null) {
        onValueChange(parsed);
      }
    },
    onBlur: () => setDraft(null),
  };
}
