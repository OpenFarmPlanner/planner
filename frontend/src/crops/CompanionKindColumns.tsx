import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { Box, Link, Stack, Typography, type SvgIconProps } from '@mui/material';
import type { ComponentType } from 'react';

import type { CompanionKind } from '../api/types';
import { useTranslation } from '../i18n';
import { COMPANION_KINDS } from './companions';

/** One neighbour as the read-only lists show it. */
export interface CompanionListItem {
  key: string | number;
  kind: CompanionKind;
  label: string;
  /** Reason and note, already joined; empty when there is neither. */
  detail: string;
  /** Opens the neighbour (a crop or a library entry); plain text without it. */
  onSelect?: () => void;
}

interface CompanionKindStyle {
  titleKey: string;
  Icon: ComponentType<SvgIconProps>;
  color: 'success.main' | 'warning.main';
}

/** Good neighbours in green, bad ones in amber, as the planning warning. */
const COMPANION_KIND_STYLES: Record<CompanionKind, CompanionKindStyle> = {
  good: { titleKey: 'companions.goodColumn', Icon: ThumbUpOutlinedIcon, color: 'success.main' },
  bad: { titleKey: 'companions.badColumn', Icon: WarningAmberOutlinedIcon, color: 'warning.main' },
};

/** The heading of one kind: icon and small capitals in the kind's colour. */
export function CompanionKindHeading({ kind }: { kind: CompanionKind }) {
  const { t } = useTranslation('crops');
  const { Icon, color, titleKey } = COMPANION_KIND_STYLES[kind];
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color }}>
      <Icon sx={{ fontSize: '1rem' }} aria-hidden />
      <Typography variant="overline" component="h4" sx={{ lineHeight: 1.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {t(titleKey)}
      </Typography>
    </Stack>
  );
}

/**
 * Good and bad neighbours side by side (one column on a phone), one line per
 * neighbour: the name, then reason and note in grey. Shared by the crop
 * details, the library page and a Sorte's read-only list in the crop form.
 */
export function CompanionKindColumns({ items }: { items: readonly CompanionListItem[] }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 3 } }}>
      {COMPANION_KINDS.map((kind) => {
        const kindItems = items.filter((item) => item.kind === kind);
        if (kindItems.length === 0) return null;
        return (
          <Box key={kind} sx={{ minWidth: 0 }} data-testid={`companion-kind-${kind}`}>
            <CompanionKindHeading kind={kind} />
            {kindItems.map((item) => (
              <Typography
                key={item.key}
                variant="body1"
                data-testid="crop-companion-row"
                sx={{ py: 0.25, overflowWrap: 'anywhere' }}
              >
                {item.onSelect ? (
                  <Link component="button" type="button" underline="hover" sx={{ verticalAlign: 'baseline', textAlign: 'left' }} onClick={item.onSelect}>
                    {item.label}
                  </Link>
                ) : item.label}
                {item.detail ? (
                  <Typography component="span" variant="body2" color="text.secondary">
                    {` · ${item.detail}`}
                  </Typography>
                ) : null}
              </Typography>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
