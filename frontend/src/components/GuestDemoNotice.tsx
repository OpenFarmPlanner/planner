import { Alert, type SxProps, type Theme } from '@mui/material';
import { useGuestDemoGuard, type GuestDemoMessageKey } from '../auth/useGuestDemoGuard';

interface GuestDemoNoticeProps {
  messageKey: GuestDemoMessageKey;
  sx?: SxProps<Theme>;
}

/**
 * Info box explaining what a page cannot do in the anonymous guest demo.
 * Renders nothing for every other account, so pages can mount it unconditionally.
 */
export function GuestDemoNotice({ messageKey, sx }: GuestDemoNoticeProps) {
  const { isGuestDemo, restrictionMessage } = useGuestDemoGuard();
  if (!isGuestDemo) {
    return null;
  }
  return (
    <Alert severity="info" sx={sx} data-testid="guest-demo-notice">
      {restrictionMessage(messageKey)}
    </Alert>
  );
}
