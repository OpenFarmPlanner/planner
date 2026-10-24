import { IconButton } from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import type { TFunction } from 'i18next';
import { AppTooltip } from '../components/AppTooltip';

interface LibraryPinButtonProps {
  pinned: boolean;
  /** Set when pinning is not possible right now (e.g. the field has no value). */
  disabledReason?: string;
  onToggle: () => void;
  t: TFunction;
}

/**
 * The pin at a field's end: filled while the field is pinned ("Fixierung
 * lösen"), a quiet outline otherwise ("Lokal fixieren").
 */
export function LibraryPinButton({ pinned, disabledReason, onToggle, t }: LibraryPinButtonProps) {
  const label = t(pinned ? 'library.pin.unpin' : 'library.pin.pin');
  const tooltip = disabledReason ?? t(pinned ? 'library.pin.unpinTooltip' : 'library.pin.pinTooltip');
  const disabled = Boolean(disabledReason) && !pinned;
  return (
    <AppTooltip title={tooltip}>
      {/* The span keeps the tooltip reachable while the button is disabled. */}
      <span>
        <IconButton
          size="small"
          edge="end"
          aria-label={label}
          aria-pressed={pinned}
          disabled={disabled}
          onClick={onToggle}
          onMouseDown={(event) => event.preventDefault()}
          data-testid="crop-form-library-pin"
          sx={{ color: pinned ? 'libraryLocal.main' : 'action.active' }}
        >
          {pinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
        </IconButton>
      </span>
    </AppTooltip>
  );
}
