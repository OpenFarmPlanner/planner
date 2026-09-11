import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  Link,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import axios from 'axios';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckIcon from '@mui/icons-material/Check';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { Season, SeasonCopyCounts } from '../api/types';
import { seasonAPI } from '../api/api';
import { useTranslation } from '../i18n';
import type { UseActiveSeasonReturn } from './useActiveSeason';
import { SeasonRowActionsMenu } from './SeasonRowActionsMenu';
import { SeasonRenameDialog } from './SeasonRenameDialog';
import { SeasonPeriodEditDialog } from './SeasonPeriodEditDialog';
import { SeasonCopyDataDialog } from './SeasonCopyDataDialog';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { computeSeasonLabel, formatSeasonPeriod, resolveSeasonDateLocale } from './formatSeasonDate';
import { addDaysIso, analyzePeriodTransition, computeManualSeasonEnd } from './seasonPeriodMath';
import { SEASON_SWITCHER_EMOJI } from '../navigation/navigationIconEmoji';
import { NavEmojiIcon } from '../navigation/NavEmojiIcon';
import { DeleteUndoSnackbar } from '../components/data-grid';
import { extractApiErrorMessage } from '../api/errors';

interface SeasonSwitcherProps {
  controller: UseActiveSeasonReturn;
  onOpenProjectSettings: () => void;
  onOpenCreateSuggestion: () => void;
  isPhone?: boolean;
  buttonPx?: number;
}

interface SeasonConflictPayload {
  code?: string | string[];
  conflict_count?: number | string | Array<number | string>;
  conflicts?: Array<{ label?: string }>;
}

interface SeasonCreateSuggestionDialogProps {
  controller: UseActiveSeasonReturn;
  open: boolean;
  onClose: () => void;
  /**
   * Close the dialog (no season is created) and open the project settings page
   * scrolled to the season-pattern section.
   */
  onEditSeasonPattern: () => void;
}

function getSeasonCreateErrorMessage(
  error: unknown,
  fallbackMessage: string,
  suggestedPeriod: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as SeasonConflictPayload | undefined;
    const code = data ? (Array.isArray(data.code) ? data.code[0] : data.code) : undefined;
    if (data && code === 'season_unassigned_data_outside_period') {
      const examples = data.conflicts
        ?.map((conflict) => conflict.label)
        .filter((label): label is string => Boolean(label))
        .join(', ');
      const conflictCount = Array.isArray(data.conflict_count)
        ? data.conflict_count[0]
        : data.conflict_count;
      return t('navigation:seasonSwitcher.suggestion.outOfRangeError', {
        count: Number(conflictCount ?? data.conflicts?.length ?? 0),
        period: suggestedPeriod,
        examples: examples || t('navigation:seasonSwitcher.suggestion.outOfRangeFallbackExamples'),
      });
    }
  }
  return extractApiErrorMessage(error, t, fallbackMessage);
}

export function SeasonCreateSuggestionDialog({
  controller,
  open,
  onClose,
  onEditSeasonPattern,
}: SeasonCreateSuggestionDialogProps) {
  const { t, i18n } = useTranslation(['navigation', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const {
    activeSeason, dueSuggestion, seasonCreationOptions,
    switchSeason, createSeason, createTransitionSeasons,
  } = controller;
  const [copyFromCurrent, setCopyFromCurrent] = useState(true);
  const [creatingSuggested, setCreatingSuggested] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [gapChoice, setGapChoice] = useState<'adopt' | 'transition' | 'manual' | ''>('');
  const [manualStartDate, setManualStartDate] = useState('');
  const [manualCopyPreview, setManualCopyPreview] = useState<SeasonCopyCounts | null>(null);

  const showSuggestion = Boolean(dueSuggestion?.start_date && dueSuggestion?.end_date);
  const suggestedLabel = showSuggestion ? computeSeasonLabel(dueSuggestion!.start_date!, dueSuggestion!.end_date!) : '';
  const suggestedPeriod = showSuggestion
    ? formatSeasonPeriod(dueSuggestion!.start_date!, dueSuggestion!.end_date!, locale)
    : '';

  // A gap or overlap between the latest existing season and the season the
  // pattern would create next — the user must decide explicitly how to bridge
  // it before anything is created (see docs/seasons-architecture.md).
  const transition = seasonCreationOptions?.transition ?? null;
  const lastSeason = seasonCreationOptions?.last_season ?? null;
  const needsGapDecision = Boolean(
    transition && lastSeason && seasonCreationOptions?.due_period && showSuggestion,
  );

  const seamlessPeriod = seasonCreationOptions?.seamless_period ?? null;
  const duePeriod = seasonCreationOptions?.due_period ?? null;
  const followupLabel = duePeriod ? computeSeasonLabel(duePeriod.start_date, duePeriod.end_date) : '';
  const copyFromLabel = seasonCreationOptions?.copy_source_label ?? activeSeason?.label ?? '';
  const manualEndDate = manualStartDate && seasonCreationOptions
    ? computeManualSeasonEnd(
      manualStartDate,
      seasonCreationOptions.start_day,
      seasonCreationOptions.start_month,
    )
    : '';
  const manualValid = Boolean(manualStartDate && manualEndDate && manualEndDate > manualStartDate);
  // Default for the manual option: the date that closes the gap / avoids the
  // overlap completely, so the field starts on the seamless join instead of
  // empty or on the pattern-computed date.
  const seamlessStartDate = lastSeason ? addDaysIso(lastSeason.end_date, 1) : '';
  const manualResidual = manualValid && lastSeason
    ? analyzePeriodTransition(lastSeason.end_date, manualStartDate)
    : null;

  // The copy split for the manual option depends on the chosen start date, so
  // it is re-fetched from the server rather than derived client-side (which
  // would need the source season's planting dates).
  useEffect(() => {
    if (gapChoice !== 'manual' || !manualValid) {
      setManualCopyPreview(null);
      return;
    }
    let cancelled = false;
    seasonAPI.creationOptions({ manual_start_date: manualStartDate })
      .then((response) => {
        if (!cancelled) {
          setManualCopyPreview(response.data.copy_preview.manual);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setManualCopyPreview(null);
        }
      });
    return () => { cancelled = true; };
  }, [gapChoice, manualValid, manualStartDate]);

  const activeCopyPreview: SeasonCopyCounts | null = (() => {
    const preview = seasonCreationOptions?.copy_preview;
    if (!needsGapDecision || gapChoice === 'adopt') {
      return preview?.adopt ?? null;
    }
    if (gapChoice === 'transition') {
      return preview?.transition ?? null;
    }
    if (gapChoice === 'manual') {
      return manualCopyPreview;
    }
    return null;
  })();
  const followupCopyPreview = seasonCreationOptions?.copy_preview?.transition_followup ?? null;

  const resetTransientState = () => {
    setCreateError(null);
    setCopyFromCurrent(true);
    setGapChoice('');
    setManualStartDate('');
    setManualCopyPreview(null);
  };

  const handleClose = () => {
    if (!creatingSuggested) {
      resetTransientState();
      onClose();
    }
  };

  const handleEditSeasonPattern = () => {
    if (!creatingSuggested) {
      resetTransientState();
      onEditSeasonPattern();
    }
  };

  const resolveCreatePeriod = (): { start: string; end: string } | null => {
    if (!dueSuggestion?.start_date || !dueSuggestion.end_date) {
      return null;
    }
    if (!needsGapDecision) {
      return { start: dueSuggestion.start_date, end: dueSuggestion.end_date };
    }
    if (gapChoice === 'adopt') {
      return { start: dueSuggestion.start_date, end: dueSuggestion.end_date };
    }
    if (gapChoice === 'transition' && seamlessPeriod) {
      return { start: seamlessPeriod.start_date, end: seamlessPeriod.end_date };
    }
    if (gapChoice === 'manual' && manualValid) {
      return { start: manualStartDate, end: manualEndDate };
    }
    return null;
  };

  // The transition option creates two seasons: the gap-filling transition
  // season plus the regular follow-up season the pattern computes next.
  const isTransitionTwoSeason = needsGapDecision && gapChoice === 'transition';
  const canSubmit = !creatingSuggested && (
    isTransitionTwoSeason
      ? Boolean(seamlessPeriod && duePeriod)
      : resolveCreatePeriod() !== null
  );

  const handleCreateSuggested = async () => {
    setCreatingSuggested(true);
    setCreateError(null);
    try {
      const copySourceId = copyFromCurrent && activeSeason ? activeSeason.id : undefined;
      let seasonToActivate: Season;
      if (isTransitionTwoSeason && seamlessPeriod && duePeriod) {
        // One server call creates both seasons and distributes the last
        // season's plans across them (each plan routed to the season its
        // shifted planting date lands in).
        const result = await createTransitionSeasons(copyFromCurrent && Boolean(activeSeason));
        seasonToActivate = result.followup_season;
      } else {
        const period = resolveCreatePeriod();
        if (!period) {
          setCreatingSuggested(false);
          return;
        }
        seasonToActivate = await createSeason(period.start, period.end, copySourceId);
      }
      resetTransientState();
      onClose();
      switchSeason(seasonToActivate.id);
    } catch (error) {
      setCreateError(getSeasonCreateErrorMessage(
        error,
        t('navigation:seasonSwitcher.suggestion.createError'),
        suggestedPeriod,
        t,
      ));
    } finally {
      setCreatingSuggested(false);
    }
  };

  return (
    <Dialog open={open && showSuggestion} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('navigation:seasonSwitcher.suggestion.confirmTitle', { label: suggestedLabel })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {suggestedPeriod}
          </Typography>
          {createError ? <Alert severity="error">{createError}</Alert> : null}

          {needsGapDecision && transition && lastSeason ? (
            <Stack spacing={1.5}>
              <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />}>
                {t(`navigation:seasonSwitcher.suggestion.gap.intro.${transition.kind}`, {
                  label: lastSeason.label,
                  period: formatSeasonPeriod(transition.start_date, transition.end_date, locale),
                })}
              </Alert>
              <FormControl>
                <FormLabel sx={{ typography: 'body2', mb: 0.5 }}>
                  {t('navigation:seasonSwitcher.suggestion.gap.chooseLabel')}
                </FormLabel>
                <RadioGroup
                  value={gapChoice}
                  onChange={(event) => {
                    const choice = event.target.value as typeof gapChoice;
                    setGapChoice(choice);
                    if (choice === 'manual' && !manualStartDate && seamlessStartDate) {
                      setManualStartDate(seamlessStartDate);
                    }
                  }}
                >
                  <FormControlLabel
                    value="adopt"
                    control={<Radio />}
                    sx={{ alignItems: 'flex-start', mt: 0.5 }}
                    label={(
                      <Stack sx={{ pt: 0.75 }}>
                        <Typography variant="body2">
                          {t(`navigation:seasonSwitcher.suggestion.gap.adopt.${transition.kind}`)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatSeasonPeriod(dueSuggestion!.start_date!, dueSuggestion!.end_date!, locale)}
                        </Typography>
                      </Stack>
                    )}
                  />
                  <FormControlLabel
                    value="transition"
                    control={<Radio />}
                    sx={{ alignItems: 'flex-start', mt: 0.5 }}
                    label={(
                      <Stack sx={{ pt: 0.75 }}>
                        <Typography variant="body2">
                          {t('navigation:seasonSwitcher.suggestion.gap.transition')}
                        </Typography>
                        {seamlessPeriod && duePeriod ? (
                          <Typography variant="caption" color="text.secondary">
                            {t('navigation:seasonSwitcher.suggestion.gap.transitionTwoSeasons', {
                              transitionPeriod: formatSeasonPeriod(
                                seamlessPeriod.start_date, seamlessPeriod.end_date, locale,
                              ),
                              followupLabel,
                              followupPeriod: formatSeasonPeriod(
                                duePeriod.start_date, duePeriod.end_date, locale,
                              ),
                            })}
                          </Typography>
                        ) : null}
                      </Stack>
                    )}
                  />
                  <FormControlLabel
                    value="manual"
                    control={<Radio />}
                    sx={{ alignItems: 'flex-start', mt: 0.5 }}
                    label={(
                      <Stack sx={{ pt: 0.75 }}>
                        <Typography variant="body2">
                          {t('navigation:seasonSwitcher.suggestion.gap.manual')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t('navigation:seasonSwitcher.suggestion.gap.manualCaption')}
                        </Typography>
                      </Stack>
                    )}
                  />
                </RadioGroup>
              </FormControl>
              {gapChoice === 'manual' ? (
                <Stack spacing={1} sx={{ pl: 4 }}>
                  <TextField
                    type="date"
                    size="small"
                    label={t('navigation:seasonSwitcher.suggestion.gap.manualStartLabel')}
                    value={manualStartDate}
                    onChange={(event) => setManualStartDate(event.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  {manualValid ? (
                    <>
                      <Typography variant="body2" color="text.secondary">
                        {t('navigation:seasonSwitcher.suggestion.gap.manualPeriod', {
                          period: formatSeasonPeriod(manualStartDate, manualEndDate, locale),
                        })}
                      </Typography>
                      {manualResidual === null ? (
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start', color: 'success.main' }}>
                          <CheckCircleOutlineIcon fontSize="small" sx={{ mt: 0.25 }} />
                          <Typography variant="body2">
                            {t(`navigation:seasonSwitcher.suggestion.gap.residualClosed.${transition.kind}`)}
                          </Typography>
                        </Stack>
                      ) : (
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start', color: 'warning.dark' }}>
                          <WarningAmberIcon fontSize="small" sx={{ mt: 0.25 }} />
                          <Typography variant="body2">
                            {t(`navigation:seasonSwitcher.suggestion.gap.residualRemains.${manualResidual.kind}`, {
                              period: formatSeasonPeriod(
                                manualResidual.start_date,
                                manualResidual.end_date,
                                locale,
                              ),
                            })}
                          </Typography>
                        </Stack>
                      )}
                    </>
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          ) : null}

          {activeSeason ? (
            <Stack
              spacing={1}
              sx={{
                borderRadius: 1,
                bgcolor: 'success.50',
                p: 1.5,
              }}
            >
              <FormControlLabel
                sx={{ alignItems: 'flex-start', m: 0 }}
                control={(
                  <Checkbox
                    checked={copyFromCurrent}
                    onChange={(event) => setCopyFromCurrent(event.target.checked)}
                    sx={{ pt: 0 }}
                  />
                )}
                label={(
                  <Stack spacing={0.5}>
                    <Typography variant="body2">
                      {t('navigation:seasonSwitcher.suggestion.copyCheckbox', { label: activeSeason.label })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('navigation:seasonSwitcher.suggestion.copyDescription')}
                    </Typography>
                  </Stack>
                )}
              />
              {copyFromCurrent && activeCopyPreview && activeCopyPreview.total > 0 ? (
                <Typography
                  variant="caption"
                  color={activeCopyPreview.skipped > 0 ? 'warning.dark' : 'text.secondary'}
                  sx={{ pl: 4 }}
                >
                  {t(
                    activeCopyPreview.skipped > 0
                      ? 'navigation:seasonSwitcher.suggestion.gap.copyPreviewPartial'
                      : 'navigation:seasonSwitcher.suggestion.gap.copyPreviewAll',
                    { ...activeCopyPreview, label: copyFromLabel },
                  )}
                </Typography>
              ) : null}
              {copyFromCurrent && isTransitionTwoSeason && followupCopyPreview && followupCopyPreview.total > 0 ? (
                <Typography
                  variant="caption"
                  color={followupCopyPreview.skipped > 0 ? 'warning.dark' : 'text.secondary'}
                  sx={{ pl: 4 }}
                >
                  {t('navigation:seasonSwitcher.suggestion.gap.copyPreviewFollowup', {
                    ...followupCopyPreview,
                    label: followupLabel,
                  })}
                </Typography>
              ) : null}
            </Stack>
          ) : null}
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              p: 1.5,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'action.hover',
            }}
          >
            <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.375, flexShrink: 0 }} />
            <Typography variant="body2" color="text.secondary">
              {t('navigation:seasonSwitcher.suggestion.patternHint.prefix')}
              {' '}
              <Link
                component="button"
                type="button"
                onClick={handleEditSeasonPattern}
                sx={{
                  fontWeight: 700,
                  fontSize: 'inherit',
                  color: 'primary.main',
                  textDecoration: 'none',
                  verticalAlign: 'baseline',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                {t('navigation:seasonSwitcher.suggestion.patternHint.link')}
              </Link>
              {' '}
              {t('navigation:seasonSwitcher.suggestion.patternHint.suffix')}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <DisabledActionTooltip title={creatingSuggested ? t('common:disabledReasons.busy') : ''}>
          <Button onClick={handleClose} disabled={creatingSuggested}>
            {t('common:actions.cancel')}
          </Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip
          title={creatingSuggested
            ? t('common:disabledReasons.busy')
            : !canSubmit
              ? t('navigation:seasonSwitcher.suggestion.createDisabledTooltip')
              : ''}
        >
          <Button variant="contained" onClick={() => void handleCreateSuggested()} disabled={!canSubmit}>
              {t('navigation:seasonSwitcher.suggestion.create')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}

export function SeasonSwitcher({
  controller,
  onOpenProjectSettings,
  onOpenCreateSuggestion,
  isPhone = false,
  buttonPx,
}: SeasonSwitcherProps) {
  const { t, i18n } = useTranslation(['navigation', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const {
    seasons, activeSeason, dueSuggestion, pendingDeletions,
    switchSeason, renameSeason, updateSeasonPeriod, copyDataInto, deleteSeason,
    undoPendingDeletion, closePendingDeletionSnackbar,
  } = controller;

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState<HTMLElement | null>(null);
  const [rowMenuSeasonId, setRowMenuSeasonId] = useState<number | null>(null);
  const [renameSeasonTarget, setRenameSeasonTarget] = useState<Season | null>(null);
  const [periodEditTarget, setPeriodEditTarget] = useState<Season | null>(null);
  const [copyDialogTarget, setCopyDialogTarget] = useState<Season | null>(null);

  const rowMenuSeason = seasons.find((season) => season.id === rowMenuSeasonId) ?? null;
  const showSuggestion = Boolean(dueSuggestion?.due && dueSuggestion?.start_date && dueSuggestion?.end_date);
  const suggestedLabel = showSuggestion ? computeSeasonLabel(dueSuggestion!.start_date!, dueSuggestion!.end_date!) : '';
  const suggestedPeriod = showSuggestion
    ? formatSeasonPeriod(dueSuggestion!.start_date!, dueSuggestion!.end_date!, locale)
    : '';

  const closeMenu = () => setMenuAnchor(null);

  const handleOpenSuggestionDialog = () => {
    closeMenu();
    onOpenCreateSuggestion();
  };

  return (
    <>
      <Button
        aria-label={t('navigation:seasonSwitcher.ariaLabel')}
        aria-controls={menuAnchor ? 'season-switcher-menu' : undefined}
        aria-haspopup="true"
        onClick={(event) => setMenuAnchor(event.currentTarget)}
        size="small"
        sx={{
          color: 'text.primary',
          textTransform: 'none',
          maxWidth: { xs: 76, sm: 180 },
          minWidth: 0,
          px: buttonPx ?? (isPhone ? 0.75 : 1),
        }}
        startIcon={!isPhone ? <NavEmojiIcon emoji={SEASON_SWITCHER_EMOJI} /> : undefined}
        endIcon={!isPhone ? <KeyboardArrowDownIcon fontSize="small" /> : undefined}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeSeason?.label ?? '–'}
        </Box>
      </Button>

      <Menu
        id="season-switcher-menu"
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { width: { xs: 'min(320px, calc(100vw - 32px))', sm: 340 }, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
          <Typography variant="overline" color="text.secondary">{t('navigation:seasonSwitcher.sectionTitle')}</Typography>
        </Box>

        {seasons.map((season) => {
          const isActive = season.id === activeSeason?.id;
          return (
            <MenuItem key={season.id} selected={isActive} onClick={() => { closeMenu(); switchSeason(season.id); }}>
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ fontWeight: isActive ? 700 : 500 }}>{season.label}</Typography>
                  {isActive ? <CheckIcon fontSize="small" color="primary" /> : null}
                </Stack>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {formatSeasonPeriod(season.start_date, season.end_date, locale)}
                  {' · '}
                  {t('navigation:seasonSwitcher.planCount', { count: season.planting_plan_count })}
                </Typography>
              </Stack>
              <IconButton
                size="small"
                aria-label={t('navigation:seasonSwitcher.menu.openAria')}
                onClick={(event) => {
                  event.stopPropagation();
                  setRowMenuAnchor(event.currentTarget);
                  setRowMenuSeasonId(season.id);
                }}
                sx={{ color: 'text.disabled', ml: 1 }}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </MenuItem>
          );
        })}

        {showSuggestion ? (
          <>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem onClick={handleOpenSuggestionDialog}>
              <Stack direction="row" spacing={1} sx={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
                <Box
                  component="span"
                  aria-hidden="true"
                  sx={{
                    mt: 0.25,
                    width: 2,
                    height: 2,
                    borderRadius: '50%',
                    bgcolor: 'success.main',
                    color: 'success.contrastText',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    typography: 'caption',
                    fontWeight: 700,
                    flex: '0 0 auto',
                  }}
                >
                  +
                </Box>
                <Stack sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 500 }}>
                    {t('navigation:seasonSwitcher.suggestion.title', { label: suggestedLabel })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {suggestedPeriod}
                  </Typography>
                </Stack>
              </Stack>
              <Button
                size="small"
                variant="contained"
                onClick={(event) => {
                  event.stopPropagation();
                  handleOpenSuggestionDialog();
                }}
                sx={{ ml: 1, flex: '0 0 auto' }}
              >
                {t('navigation:seasonSwitcher.suggestion.create')}
              </Button>
            </MenuItem>
          </>
        ) : null}

        <Divider sx={{ my: 0.5 }} />
        <MenuItem onClick={() => { closeMenu(); onOpenProjectSettings(); }} sx={{ whiteSpace: 'normal' }}>
          {t('navigation:seasonSwitcher.settingsLink')}
        </MenuItem>
      </Menu>

      <SeasonRowActionsMenu
        anchorEl={rowMenuAnchor}
        onClose={() => { setRowMenuAnchor(null); setRowMenuSeasonId(null); }}
        onCopyDataFrom={() => { if (rowMenuSeason) { setCopyDialogTarget(rowMenuSeason); } }}
        onRename={() => { if (rowMenuSeason) { setRenameSeasonTarget(rowMenuSeason); } }}
        onEditPeriod={() => { if (rowMenuSeason) { setPeriodEditTarget(rowMenuSeason); } }}
        onDelete={() => { if (rowMenuSeason) { void deleteSeason(rowMenuSeason); closeMenu(); } }}
      />

      <SeasonRenameDialog
        open={renameSeasonTarget !== null}
        season={renameSeasonTarget}
        onClose={() => setRenameSeasonTarget(null)}
        onConfirm={renameSeason}
      />

      <SeasonPeriodEditDialog
        open={periodEditTarget !== null}
        season={periodEditTarget}
        onClose={() => setPeriodEditTarget(null)}
        onConfirm={updateSeasonPeriod}
      />

      <SeasonCopyDataDialog
        open={copyDialogTarget !== null}
        targetSeason={copyDialogTarget}
        seasons={seasons}
        onClose={() => setCopyDialogTarget(null)}
        onConfirm={copyDataInto}
      />

      {pendingDeletions.map((deletion, index) => (
        <DeleteUndoSnackbar
          key={deletion.id}
          open={deletion.visible}
          message={deletion.message}
          undoLabel={t('navigation:seasonSwitcher.undo')}
          offsetIndex={index}
          testId={`season-delete-undo-snackbar-${deletion.id}`}
          onClose={() => closePendingDeletionSnackbar(deletion.id)}
          onUndo={() => void undoPendingDeletion(deletion.id)}
        />
      ))}
    </>
  );
}
