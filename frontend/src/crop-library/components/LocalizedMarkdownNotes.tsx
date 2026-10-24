import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Box, Chip, Stack } from '@mui/material';
import TranslateOutlinedIcon from '@mui/icons-material/TranslateOutlined';
import { AppTooltip } from '../../components/AppTooltip';
// Cross-domain import: a markdown helper that today lives under the
// app-specific data-grid module. Kept as-is rather than duplicated/moved —
// see docs/crop-library-architecture.md for why this is flagged as a
// future cleanup candidate rather than fixed now.
import { normalizeMarkdownSource } from '../../components/data-grid/markdown';
import { markdownComponents } from '../../components/data-grid/markdownComponents';
import { useTranslation } from '../../i18n';
import { getDescriptionFallbackNotice, type LocalizedText } from '../publicCropDisplay';

const notesMarkdownSx = {
  '& h3': { mt: 2, mb: 1, fontSize: '1.05rem' },
  '& h3:first-of-type': { mt: 0.25 },
  '& p': { mb: 1, maxWidth: '95ch' },
  '& ul': { pl: 3, mb: 1 },
  '& li': { mb: 0.5 },
  '& a': { color: 'primary.main' },
  '& em': { color: 'text.secondary' },
} as const;

interface LocalizedMarkdownNotesProps {
  /** The text to show and the language it is actually in. */
  localized: LocalizedText;
  /** Rendered instead of the markdown when there is no text. */
  emptyState?: ReactNode;
  /** Optional action next to the fallback hint (e.g. "add a translation"). */
  fallbackAction?: ReactNode;
}

/**
 * Multilingual markdown notes with the shared language-fallback rule: text
 * shown in a language other than the UI language carries the "only available
 * in …" hint and a `lang` attribute naming the language it is really in.
 */
export function LocalizedMarkdownNotes({ localized, emptyState = null, fallbackAction = null }: LocalizedMarkdownNotesProps) {
  const { t, i18n } = useTranslation('crops');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const fallbackNotice = getDescriptionFallbackNotice(localized, t, language);

  if (!localized.text) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {fallbackNotice ? (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ mb: 1, alignItems: { xs: 'flex-start', sm: 'center' } }}
        >
          <AppTooltip title={fallbackNotice.tooltip}>
            <Chip
              size="small"
              icon={<TranslateOutlinedIcon fontSize="small" />}
              label={fallbackNotice.label}
              variant="outlined"
              color="warning"
            />
          </AppTooltip>
          {fallbackAction}
        </Stack>
      ) : null}
      <Box lang={localized.languageCode ?? undefined} sx={notesMarkdownSx}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {normalizeMarkdownSource(localized.text)}
        </ReactMarkdown>
      </Box>
    </>
  );
}
