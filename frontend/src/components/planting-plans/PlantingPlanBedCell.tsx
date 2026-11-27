import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Box, IconButton, Popover, Typography } from '@mui/material';
import type { GridRowId } from '@mui/x-data-grid';

import type { RotationFinding, RotationStatus } from '../../api/types';
import { useTranslation } from '../../i18n';
import { SearchHighlightedText } from '../../search/SearchHighlightedText';
import { isContextMenuDismissGestureInProgress } from '../../utils/contextMenu';
import { AppTooltip } from '../AppTooltip';
import { isAnyContextMenuOpen } from '../contextMenu/contextMenuOpenState';
import { useDialogEditCellOpenRequest } from '../data-grid/DialogEditCellContext';
import { dismissGridTooltipForEdit, useGridTooltipScope } from '../data-grid/gridTooltipState';
import { BED_PATH_SEPARATOR, type BedPickerOption, type BedPickerResult } from './bedPickerOptions';
import { InlineBedPicker, type IndividualPickerChoices } from './InlineBedPicker';
import { IndividualPlantIcon } from '../../planting-plans/individualPlantActions';
import { placementLabelKey, type PlacementParent } from '../../pages/individualPlantGeometry';
import { RotationCheckPanel } from './rotation/RotationCheckPanel';
import { ReadOnlyRotationWarning, RotationStatusIcon } from './rotation/RotationStatusIcon';
import { getMissingDataLines, getTableRotationStatus } from './rotation/rotationCopy';
import type { RotationInput } from './rotation/useRotationQueries';

interface PlantingPlanBedCellProps {
  rowId: GridRowId;
  field: string;
  hasFocus: boolean;
  readOnly: boolean;
  path: { locationName: string; fieldName: string; name: string };
  options: BedPickerResult[];
  selected?: BedPickerOption;
  rotation: RotationInput & {
    status: RotationStatus | null;
    findings?: RotationFinding[] | null;
    cultureLabel: string;
  };
  numberLocale: string;
  onSelect: (bedId: number, freeAreaSqm: number | null) => Promise<boolean>;
  onAccept: (accepted: boolean) => Promise<void>;
  endAdornment?: ReactNode;
  individualChoices?: IndividualPickerChoices;
  placement?: PlacementParent | null;
}

export function PlantingPlanBedCell({
  rowId, field, hasFocus, readOnly, path, options, selected, rotation, numberLocale,
  onSelect, onAccept, endAdornment, individualChoices, placement,
}: PlantingPlanBedCellProps) {
  const { t } = useTranslation('plantingPlans');
  const tooltipScope = useGridTooltipScope();
  const cellRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const rotationButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const pendingSelectionRef = useRef(false);
  const [editor, setEditor] = useState<{ anchor: HTMLElement; initialQuery: string } | null>(null);
  const [conflictAnchor, setConflictAnchor] = useState<HTMLButtonElement | null>(null);
  const [savingBed, setSavingBed] = useState(false);
  const [pendingAcceptance, setPendingAcceptance] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState(false);
  const conflictId = useId();

  const openEditor = useCallback((initialQuery = ''): void => {
    const anchor = cellRef.current;
    if (readOnly || !anchor || pendingSelectionRef.current
      || isAnyContextMenuOpen() || isContextMenuDismissGestureInProgress()) return;
    setEditor((opened) => opened ?? { anchor, initialQuery });
  }, [readOnly]);
  useDialogEditCellOpenRequest(rowId, field, openEditor);

  const closeEditor = useCallback((restoreFocus: boolean): void => {
    dismissGridTooltipForEdit(tooltipScope);
    restoreFocusRef.current = restoreFocus;
    setEditor(null);
  }, [tooltipScope]);
  useLayoutEffect(() => {
    if (!editor && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      textRef.current?.focus({ preventScroll: true });
    }
  }, [editor]);

  const submitBed = async (bedId: number, freeAreaSqm: number | null): Promise<boolean> => {
    if (pendingSelectionRef.current) return false;
    pendingSelectionRef.current = true;
    setSavingBed(true);
    try {
      return await onSelect(bedId, freeAreaSqm);
    } finally {
      pendingSelectionRef.current = false;
      setSavingBed(false);
    }
  };

  const prefix = [path.locationName, path.fieldName].filter(Boolean).join(BED_PATH_SEPARATOR);
  const placementLabel = placement ? t(placementLabelKey(placement.kind)) : '';
  const tooltip = [prefix, path.name, placementLabel].filter(Boolean).join(BED_PATH_SEPARATOR);
  const status = getTableRotationStatus(rotation.status, rotation.findings);
  const showRotation = !readOnly && !savingBed && (status === 'conflict' || status === 'accepted' || status === 'info');
  const label = showRotation ? t(`bedPicker.rotation.${status}`) : '';
  const statusTooltip = status === 'info'
    ? getMissingDataLines(rotation.findings, t, rotation.cultureLabel).join(' ')
    : label;

  const setAcceptance = async (accepted: boolean): Promise<void> => {
    if (pendingAcceptance !== null) return;
    setSaveError(false);
    setPendingAcceptance(accepted);
    try {
      await onAccept(accepted);
    } catch {
      setSaveError(true);
    } finally {
      setPendingAcceptance(null);
    }
  };

  return (
    <Box ref={cellRef} sx={{ display: 'flex', minWidth: 0, width: '100%', height: '100%', alignItems: 'center', gap: 0.25 }}>
      {editor ? (
        <InlineBedPicker
          {...editor}
          options={options}
          selected={selected}
          rotation={rotation}
          numberLocale={numberLocale}
          onClose={closeEditor}
          onSelect={submitBed}
          individual={individualChoices}
        />
      ) : (
        <>
          <AppTooltip
            title={tooltip}
            open={conflictAnchor ? false : undefined}
            cellHasFocus={hasFocus}
            describeChild
            disableInteractive
          >
            <Box
              component="span"
              ref={textRef}
              tabIndex={hasFocus ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key === 'Tab' && !event.shiftKey && rotationButtonRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  rotationButtonRef.current.focus();
                }
              }}
              sx={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', outline: 'none' }}
            >
              {placement && <IndividualPlantIcon fontSize="small" titleAccess={placementLabel}
                sx={{ flexShrink: 0, mr: 0.5, color: 'text.secondary' }} />}
              {prefix && (
                <Typography component="span" variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                  <SearchHighlightedText text={prefix} />
                </Typography>
              )}
              {prefix && path.name && <Box component="span" aria-hidden sx={{ mx: 0.5, color: 'text.secondary' }}>›</Box>}
              <Typography component="span" variant="body2" sx={{ fontWeight: path.name ? 500 : 400, flexShrink: 0 }}>
                {path.name ? <SearchHighlightedText text={path.name} /> : !prefix && t('placeholders.selectArea')}
              </Typography>
            </Box>
          </AppTooltip>
          {endAdornment}
          {readOnly && (status === 'conflict' || status === 'info') && (
            <ReadOnlyRotationWarning status={status} findings={rotation.findings} cultureLabel={rotation.cultureLabel} tabIndex={hasFocus ? 0 : -1} />
          )}
          {showRotation && (
            <AppTooltip title={statusTooltip}>
              <IconButton
                ref={rotationButtonRef}
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={Boolean(conflictAnchor)}
                aria-controls={conflictAnchor ? conflictId : undefined}
                tabIndex={hasFocus ? 0 : -1}
                data-testid="rotation-status-button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSaveError(false);
                  setConflictAnchor(event.currentTarget);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Tab' && event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    textRef.current?.focus();
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation();
                  }
                }}
                sx={{ width: 32, minHeight: 32, flexShrink: 0, '@media (pointer: coarse)': { width: 44, minHeight: 44 } }}
              >
                <RotationStatusIcon status={status} fontSize="small" sx={status === 'accepted' ? { color: 'text.secondary' } : undefined} />
              </IconButton>
            </AppTooltip>
          )}
        </>
      )}
      {conflictAnchor && (
        <Popover
          open
          anchorEl={conflictAnchor}
          onClose={() => {
            if (pendingAcceptance !== null) return;
            setConflictAnchor(null);
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { id: conflictId, role: 'dialog', 'aria-label': label, sx: { width: 'min(460px, calc(100vw - 32px))', p: 1.5 } } }}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Box aria-busy={pendingAcceptance !== null}>
            <RotationCheckPanel
              input={rotation}
              bedLabel={path.name}
              cultureLabel={rotation.cultureLabel}
              acceptance={readOnly ? undefined : {
                accepted: pendingAcceptance ?? (status === 'accepted'),
                persisted: null,
                disabled: pendingAcceptance !== null,
                onChange: (value) => void setAcceptance(value),
              }}
              showConflictActions
            />
            {saveError && <Alert severity="error" sx={{ mt: 1 }}>{t('errors.save')}</Alert>}
          </Box>
        </Popover>
      )}
    </Box>
  );
}
