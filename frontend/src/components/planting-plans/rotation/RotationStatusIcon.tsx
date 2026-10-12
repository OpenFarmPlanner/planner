import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { createSvgIcon, type SvgIconProps } from '@mui/material';

import type { RotationStatus } from '../../../api/types';

/**
 * A filled warning triangle with a check mark cut out: a conflict that was
 * accepted. Filled (unlike the outlined conflict triangle) so the two stay
 * distinguishable at table-icon size.
 */
const AcceptedConflictIcon = createSvgIcon(
  <path fillRule="evenodd" d="M12 2 1 21h22zm-1.8 15.5-2.8-2.8 1.06-1.06 1.74 1.74 4.14-4.14 1.06 1.06z" />,
  'AcceptedConflict',
);

const ICONS = {
  conflict: { Icon: WarningAmberOutlinedIcon, color: 'warning' },
  accepted: { Icon: AcceptedConflictIcon, color: 'warning' },
  hint: { Icon: InfoOutlinedIcon, color: 'info' },
  info: { Icon: HelpOutlineIcon, color: 'action' },
  ok: { Icon: CheckCircleOutlineIcon, color: 'success' },
} as const satisfies Record<RotationStatus, { Icon: typeof InfoOutlinedIcon; color: SvgIconProps['color'] }>;

interface RotationStatusIconProps extends Omit<SvgIconProps, 'color'> {
  status: RotationStatus;
}

/**
 * One icon per rotation status. The shapes differ (triangle, triangle with
 * check, info circle, question circle, check circle), so the status never
 * depends on colour alone.
 */
export function RotationStatusIcon({ status, ...props }: RotationStatusIconProps) {
  const { Icon, color } = ICONS[status];
  return <Icon color={color} data-rotation-status={status} {...props} />;
}
