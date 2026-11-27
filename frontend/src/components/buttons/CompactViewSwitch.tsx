import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined';
import LocalFloristOutlinedIcon from '@mui/icons-material/LocalFloristOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import type { TopbarContextAction } from '../../navigation/topbarTypes';
import { AppTooltip } from '../AppTooltip';
import { TOOLBAR_ACTION_MIN_HEIGHT } from './ResponsiveToolbarAction';

const viewIcons = new Map([
  ['fields-view-mode-list', <ViewListOutlinedIcon fontSize="small" />],
  ['fields-view-mode-graphical', <MapOutlinedIcon fontSize="small" />],
  ['calendar-view-mode-occupancy', <EventNoteOutlinedIcon fontSize="small" />],
  ['calendar-view-mode-seedlings', <LocalFloristOutlinedIcon fontSize="small" />],
]);

export function CompactViewSwitch({ actions, label, marginLeft }: {
  actions: readonly TopbarContextAction[];
  label: string;
  marginLeft?: number;
}) {
  return (
    <ToggleButtonGroup exclusive size="small" value={actions.find(action => action.active)?.id ?? null}
      aria-label={label} sx={{ ml: marginLeft, flexShrink: 0, '& .MuiToggleButton-root': {
        width: TOOLBAR_ACTION_MIN_HEIGHT, height: TOOLBAR_ACTION_MIN_HEIGHT, p: 0,
        borderColor: 'divider', color: 'text.primary', visibility: 'visible',
        '&.Mui-selected': {
          bgcolor: 'success.main', color: 'success.contrastText', borderColor: 'success.dark', borderWidth: 2, boxShadow: 1,
        },
        '&.Mui-selected:hover': { bgcolor: 'success.dark' },
      } }}>
      {actions.map(action => {
        const icon = viewIcons.get(action.id);
        return icon ? (
          <AppTooltip key={action.id} title={action.tooltip ?? action.label} describeChild enterTouchDelay={0}>
            <ToggleButton value={action.id} aria-label={action.ariaLabel ?? action.label} onClick={action.onClick}
              disabled={action.disabled} sx={action.hidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
              {icon}
            </ToggleButton>
          </AppTooltip>
        ) : null;
      })}
    </ToggleButtonGroup>
  );
}
