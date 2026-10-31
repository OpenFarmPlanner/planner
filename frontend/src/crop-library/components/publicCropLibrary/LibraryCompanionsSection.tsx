import { Box, Link, Typography } from '@mui/material';

import type { CompanionKind, PublicCrop } from '../../../api/types';
import { COMPANION_KINDS, companionReasonLabelKey, type LibraryCompanionRow } from '../../../crops/companions';
import { useTranslation } from '../../../i18n';
import { DetailSection } from './DetailPrimitives';

interface LibraryCompanionsSectionProps {
  rows: readonly LibraryCompanionRow[];
  onSelectEntry: (entry: PublicCrop) => void;
}

const KIND_TITLE_KEYS: Record<CompanionKind, string> = {
  good: 'companions.goodColumn',
  bad: 'companions.badColumn',
};

/** "Mischkultur" on the library page; a neighbour with an entry links to it. */
export function LibraryCompanionsSection({ rows, onSelectEntry }: LibraryCompanionsSectionProps) {
  const { t } = useTranslation('crops');
  return (
    <DetailSection title={t('companions.title')}>
      <Box
        data-testid="library-companions-section"
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 3 } }}
      >
        {COMPANION_KINDS.map((kind) => {
          const kindRows = rows.filter((row) => row.kind === kind);
          if (kindRows.length === 0) return null;
          return (
            <Box key={kind} sx={{ minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary">{t(KIND_TITLE_KEYS[kind])}</Typography>
              {kindRows.map((row, index) => {
                const reason = row.reason === 'other' ? '' : t(companionReasonLabelKey(row.reason));
                const detail = [reason, row.note].filter(Boolean).join(': ');
                const { entry } = row;
                return (
                  <Box key={`${row.label}-${index}`} data-testid="library-companion-row" sx={{ py: 0.5 }}>
                    {entry ? (
                      <Link
                        component="button"
                        type="button"
                        variant="body1"
                        underline="hover"
                        sx={{ textAlign: 'left' }}
                        onClick={() => onSelectEntry(entry)}
                      >
                        {row.label}
                      </Link>
                    ) : (
                      <Typography variant="body1">{row.label}</Typography>
                    )}
                    {detail ? (
                      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {detail}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>
    </DetailSection>
  );
}
