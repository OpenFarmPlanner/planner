import { Fragment, type ReactElement, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { Trans } from 'react-i18next';

import type { CropSpeciesSearchMatch } from '../api/types';
import { useTranslation } from '../i18n';
import { findMatchRanges, normalizeSearchText } from '../search/searchText';
import { normalizeCropSpeciesSearchValue } from './cropSpeciesMatching';

interface MatchHighlightProps {
  text: string;
  /** The raw typed search value. */
  query: string;
}

/** `text` with every occurrence of the typed `query` in bold. */
function MatchHighlight({ text, query }: MatchHighlightProps): ReactElement {
  const needle = normalizeSearchText(normalizeCropSpeciesSearchValue(query));
  const ranges = needle ? findMatchRanges(text, [needle]) : [];
  if (ranges.length === 0) {
    return <>{text}</>;
  }

  const segments: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push(text.slice(cursor, range.start));
    }
    segments.push(
      <Box component="strong" key={range.start} sx={{ fontWeight: 'fontWeightBold' }}>
        {text.slice(range.start, range.end)}
      </Box>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }
  return <>{segments}</>;
}

export interface CropSpeciesOptionContentProps {
  /** The name the species is listed under — never with a matched alias appended. */
  officialName: string;
  scientificName?: string;
  /** Why the species matched the typed value; null when nothing was typed. */
  match: CropSpeciesSearchMatch | null;
  /** The raw typed search value, for the bold match highlight. */
  query: string;
  /** True for a species proposal that still awaits moderation. */
  pending?: boolean;
}

/**
 * One "Offizielle Kulturart" option: the official name on the first line and,
 * on a second, smaller line, why it matched ("Synonym: Porree", "Ähnlicher
 * Name") plus the botanical name. Both lines are plain text content of the
 * option, so they are part of its accessible name.
 */
export function CropSpeciesOptionContent({
  officialName,
  scientificName,
  match,
  query,
  pending = false,
}: CropSpeciesOptionContentProps): ReactElement {
  const { t } = useTranslation('crops');
  const primaryText = pending
    ? t('library.speciesPicker.pendingOptionSuffix', { name: officialName })
    : officialName;

  const secondaryParts: Array<{ key: string; content: ReactNode }> = [];
  if (match?.source === 'synonym' && match.synonym) {
    secondaryParts.push({
      key: 'synonym',
      content: <Trans
        t={t}
        i18nKey="library.speciesPicker.matchSynonym"
        values={{ synonym: match.synonym }}
        components={{ synonym: <MatchHighlight text={match.synonym} query={query} /> }}
      />,
    });
  } else if (match?.source === 'fuzzy') {
    secondaryParts.push({ key: 'fuzzy', content: t('library.speciesPicker.matchFuzzy') });
  }
  const botanicalName = scientificName?.trim();
  if (botanicalName) {
    secondaryParts.push({
      key: 'botanical',
      content: (
        <Box component="em">
          {match?.source === 'botanical' ? <MatchHighlight text={botanicalName} query={query} /> : botanicalName}
        </Box>
      ),
    });
  }

  return (
    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Box component="span">
        {match?.source === 'name' ? <MatchHighlight text={primaryText} query={query} /> : primaryText}
      </Box>
      {secondaryParts.length > 0 ? (
        <>
          {' '}
          <Typography component="span" variant="caption" color="text.secondary">
            {secondaryParts.map((part, index) => (
              <Fragment key={part.key}>{index > 0 ? ' · ' : null}{part.content}</Fragment>
            ))}
          </Typography>
        </>
      ) : null}
    </Box>
  );
}
