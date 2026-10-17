import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material';
import InstallMobileIcon from '@mui/icons-material/InstallMobile';
import { useTranslation } from '../i18n';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePwaInstall, type ManualInstallPlatform } from './usePwaInstall';

interface InstallAppButtonProps {
  sx?: SxProps<Theme>;
}

const MANUAL_INSTRUCTION_KEYS: Record<ManualInstallPlatform, 'firefoxAndroid' | 'ios'> = {
  'manual-firefox-android': 'firefoxAndroid',
  'manual-ios': 'ios',
};

/**
 * The landing page's install CTA, on top of the browser's own (easy to miss)
 * install icon in the address bar. Renders nothing once the app is already
 * installed or on a browser that offers no installation at all. The native
 * prompt is offered on mobile widths only — desktop browsers already surface
 * their own install icon in the address bar. The manual instructions follow
 * the platform instead (Firefox Android, iOS/iPadOS), so an iPad wider than
 * the mobile breakpoint still gets them.
 */
export function InstallAppButton({ sx }: InstallAppButtonProps) {
  const { t } = useTranslation('home');
  const { mode, promptInstall } = usePwaInstall();
  const isMobile = useIsMobile();
  const [showInstructions, setShowInstructions] = useState(false);

  if (mode === 'unavailable' || (mode === 'native' && !isMobile)) {
    return null;
  }

  const handleClick = (): void => {
    if (mode === 'native') {
      void promptInstall();
      return;
    }

    setShowInstructions(true);
  };

  return (
    <>
      <Button
        variant="outlined"
        size="large"
        startIcon={<InstallMobileIcon />}
        onClick={handleClick}
        sx={sx}
      >
        {t('landing.actions.installApp')}
      </Button>
      {mode !== 'native' && (
        <Dialog open={showInstructions} onClose={() => setShowInstructions(false)} maxWidth="xs" fullWidth>
          <DialogTitle>{t('landing.installManual.title')}</DialogTitle>
          <DialogContent>
            <Typography variant="body2">{t(`landing.installManual.${MANUAL_INSTRUCTION_KEYS[mode]}`)}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowInstructions(false)}>{t('landing.installManual.dismiss')}</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
