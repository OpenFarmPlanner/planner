import type { Ref } from 'react';
import { IconButton } from '@mui/material';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import { AppTooltip } from '../components/AppTooltip';

export function CropSelectionButton({
  label, active, controlsId, onClick, buttonRef, disabled, pending,
}: {
  label: string;
  active: boolean;
  controlsId: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <AppTooltip title={label}>
      <span>
        <IconButton
          ref={buttonRef}
          size="small"
          aria-label={label}
          aria-pressed={active}
          aria-controls={active ? controlsId : undefined}
          color={pending ? 'warning' : active ? 'primary' : 'default'}
          disabled={disabled}
          sx={{ width: 40, height: 40 }}
          onClick={onClick}
        >
          <ChecklistOutlinedIcon fontSize="small" />
        </IconButton>
      </span>
    </AppTooltip>
  );
}
