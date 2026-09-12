import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TableRowsIcon from '@mui/icons-material/TableRows';
import { Divider, ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import { useTranslation } from '../../i18n';
import { copyRowsToClipboard, type TableClipboardRow } from './tableClipboard';
import { DisabledMenuItemTooltip } from '../DisabledActionTooltip';

interface TableCopyMenuItemsProps {
  rowValues: TableClipboardRow | null;
  tableRows: readonly TableClipboardRow[];
  includeDivider?: boolean;
  onClose?: () => void;
}

/**
 * The "copy row" / "copy table" pair every table context menu ends with.
 * The labels and the copy-result messages are the same `common:` strings
 * everywhere, so they live here rather than being threaded through each menu.
 */
export function TableCopyMenuItems({
  rowValues,
  tableRows,
  includeDivider = true,
  onClose,
}: TableCopyMenuItemsProps) {
  const { t } = useTranslation('common');

  const copy = async (rows: readonly TableClipboardRow[], successMessage: string): Promise<void> => {
    await copyRowsToClipboard({
      rows,
      successMessage,
      errorMessage: t('messages.copyError'),
    });
  };

  const handleCopyRow = (): void => {
    if (!rowValues) {
      return;
    }
    onClose?.();
    void copy([rowValues], t('messages.rowCopied'));
  };

  const handleCopyTable = (): void => {
    onClose?.();
    void copy(tableRows, t('messages.tableCopied'));
  };

  return (
    <>
      {includeDivider ? <Divider role="separator" /> : null}
      <DisabledMenuItemTooltip title={!rowValues ? t('disabledReasons.copyRowUnavailable') : ''}>
        <MenuItem onClick={handleCopyRow} disabled={!rowValues}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('actions.copyRow')} />
        </MenuItem>
      </DisabledMenuItemTooltip>
      <DisabledMenuItemTooltip title={tableRows.length === 0 ? t('disabledReasons.copyTableUnavailable') : ''}>
        <MenuItem onClick={handleCopyTable} disabled={tableRows.length === 0}>
          <ListItemIcon>
            <TableRowsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('actions.copyTable')} />
        </MenuItem>
      </DisabledMenuItemTooltip>
    </>
  );
}
