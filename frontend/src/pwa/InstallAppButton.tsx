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
import { useInstallPrompt } from './useInstallPrompt';

interface InstallAppButtonProps {
  sx?: SxProps<Theme>;
}

/**
 * The landing page's install CTA, on top of the browser's own (easy to miss)
 * install icon in the address bar. Renders nothing once the app is already
 * installed, on a browser that never offers installation at all (neither
 * `beforeinstallprompt` nor iOS Safari's manual flow), or on desktop — "Install
 * app" only makes sense as a mobile home-screen affordance; desktop browsers
 * already surface their own install icon in the address bar.
 */
export function InstallAppButton({ sx }: InstallAppButtonProps) {
  const { t } = useTranslation('home');
  const { canPromptInstall, isIos, isInstalled, promptInstall } = useInstallPrompt();
  const isMobile = useIsMobile();
  const [showIosInstructions, setShowIosInstructions] = useState(false);

  if (!isMobile || isInstalled || (!canPromptInstall && !isIos)) {
    return null;
  }

  const handleClick = (): void => {
    if (canPromptInstall) {
      void promptInstall();
      return;
    }

    setShowIosInstructions(true);
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
      <Dialog open={showIosInstructions} onClose={() => setShowIosInstructions(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('landing.installIos.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{t('landing.installIos.instructions')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowIosInstructions(false)}>{t('landing.installIos.dismiss')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
