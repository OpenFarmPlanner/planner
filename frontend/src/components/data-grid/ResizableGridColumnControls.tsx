import { Box, Button, Divider } from '@mui/material';
import {
  GridColumnMenu,
  GridColumnsManagement,
  useGridApiContext,
  useGridRootProps,
  type GridColumnMenuItemProps,
  type GridColumnMenuProps,
  type GridSlotProps,
} from '@mui/x-data-grid';
import { useTranslation } from '../../i18n';
import { columnAutosizeOptions } from './useGridColumnSizing';

export function ResizableGridColumnsManagement({ widthReset, ...props }: GridSlotProps['columnsManagement']) {
  const { t } = useTranslation('common');
  return <>
    <GridColumnsManagement {...props} />
    {widthReset && <>
      <Divider />
      <Box sx={{ px: 2, py: 0.5 }}>
        <Button disabled={!widthReset.enabled} onClick={widthReset.reset} size="small">
          {t('actions.resetColumnWidths')}
        </Button>
      </Box>
    </>}
  </>;
}

function AutoFitColumnMenuItem({ colDef, onClick }: GridColumnMenuItemProps) {
  const { t } = useTranslation('common');
  const apiRef = useGridApiContext();
  const { slots } = useGridRootProps();
  if (colDef.resizable === false) return null;
  const MenuItem = slots.baseMenuItem;
  return <MenuItem onClick={event => {
    onClick(event);
    void apiRef.current.autosizeColumns({ ...columnAutosizeOptions, columns: [colDef.field] });
  }}>{t('actions.autoFitColumnWidth')}</MenuItem>;
}

export function ResizableGridColumnMenu({ slots, ...props }: GridColumnMenuProps) {
  return <GridColumnMenu {...props} slots={{ ...slots, columnMenuAutoFitItem: AutoFitColumnMenuItem }} />;
}
