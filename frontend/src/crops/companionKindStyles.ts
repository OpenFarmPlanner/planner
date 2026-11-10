import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import type { SvgIconProps } from '@mui/material';
import type { ComponentType } from 'react';

import type { CompanionKind } from '../api/types';

interface CompanionKindStyle {
  titleKey: string;
  Icon: ComponentType<SvgIconProps>;
  color: 'success.main' | 'warning.main';
  /** The same colour as a component `color` prop (e.g. a button). */
  paletteColor: 'success' | 'warning';
}

/** Good neighbours in green, bad ones in amber, as the planning warning. */
export const COMPANION_KIND_STYLES: Record<CompanionKind, CompanionKindStyle> = {
  good: { titleKey: 'companions.goodColumn', Icon: ThumbUpOutlinedIcon, color: 'success.main', paletteColor: 'success' },
  bad: { titleKey: 'companions.badColumn', Icon: WarningAmberOutlinedIcon, color: 'warning.main', paletteColor: 'warning' },
};
