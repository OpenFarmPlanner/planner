import { MenuItem, TextField } from '@mui/material';
import { useTranslation } from '../i18n';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';

export function CompanionNoteLanguageField({ value, onChange, disabled, mode = 'edit' }: {
  value: string; onChange: (language: string) => void; disabled?: boolean;
  mode?: 'edit' | 'import' | 'export';
}) {
  const { t } = useTranslation('crops');
  return <TextField select size="small" fullWidth label={t('companions.noteLanguage')}
    value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
    helperText={t(`companions.languageHelp.${mode}`)}>
    {SUPPORTED_LANGUAGES.map((language) => <MenuItem key={language.code} value={language.code}>{language.label}</MenuItem>)}
  </TextField>;
}
