import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ViewAgendaOutlinedIcon from '@mui/icons-material/ViewAgendaOutlined';
import { Box, Button, InputBase, Link, Paper, Popper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';

import type { BedSuggestion } from '../../api/types';
import { useTranslation } from '../../i18n';
import { formatAreaM2 } from '../../pages/plantingPlansUtils';
import { SearchHighlightedText } from '../../search/SearchHighlightedText';
import { tokenizeSearchQuery } from '../../search/searchText';
import { SearchHighlightContext } from '../../search/SearchHighlightContext';
import { formatLocalizedNumber } from '../../utils/numberLocalization';
import { ALL_BEDS, BED_PATH_SEPARATOR, isBedInScope, type BedPickerOption, type BedPickerResult, type BedPickerScope } from './bedPickerOptions';
import { RotationStatusIcon } from './rotation/RotationStatusIcon';
import { formatIsoDate, getBedCapacityText, getPrimaryFinding } from './rotation/rotationCopy';
import { useFamilyNameResolver } from './rotation/useFamilyNameResolver';
import { useBedSuggestions, type RotationInput } from './rotation/useRotationQueries';

interface InlineBedPickerProps {
  anchor: HTMLElement;
  initialQuery: string;
  options: BedPickerResult[];
  selected: BedPickerOption | undefined;
  rotation: RotationInput;
  numberLocale: string;
  onClose: (restoreFocus: boolean) => void;
  onSelect: (bedId: number, freeAreaSqm: number | null) => Promise<boolean>;
}

const touchButtonSx = { minHeight: 44, minWidth: 44, maxWidth: '100%', overflowWrap: 'anywhere', textTransform: 'none' } as const;
const icons = { location: LocationOnOutlinedIcon, field: CropSquareIcon, bed: ViewAgendaOutlinedIcon };
const resultId = (result: BedPickerResult): string => `${result.kind}-${result.id}`;

export function InlineBedPicker({ anchor, initialQuery, options, selected, rotation, numberLocale, onClose, onSelect }: InlineBedPickerProps) {
  const { t, i18n } = useTranslation('plantingPlans');
  const familyName = useFamilyNameResolver();
  const listId = useId();
  const scopeId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const submittingRef = useRef(false);
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<BedPickerScope>(selected ?? ALL_BEDS);
  const [activeId, setActiveId] = useState<string | null>(initialQuery || !selected ? null : resultId(selected));
  const [submitting, setSubmitting] = useState(false);
  const terms = useMemo(() => tokenizeSearchQuery(query), [query]);
  const matches = useMemo(() => options.filter((option) => terms.every((term) => option.searchText.includes(term))), [options, terms]);
  const visible = matches.filter((option) => (
    isBedInScope(option, scope) && (option.kind === 'bed'
      || (option.kind === 'location' ? scope.locationId === null : scope.fieldId === null))
  ));
  const outsideCount = matches.filter((option) => !isBedInScope(option, scope)).length;
  const scopeOption = options.find((option) => scope.fieldId !== null
    ? option.kind === 'field' && option.id === scope.fieldId
    : option.kind === 'location' && option.id === scope.locationId);
  const inScope = Boolean(scopeOption);
  const hasBeds = options.some((option) => option.kind === 'bed');
  const suggestions = useBedSuggestions(rotation, hasBeds);
  const suggestionsByBed = useMemo(() => new Map(
    suggestions.data?.results.map((suggestion) => [suggestion.bed_id, suggestion]) ?? [],
  ), [suggestions.data]);
  // Confirming the current bed closes the picker without writing an assignment.
  const canChoose = (option: BedPickerResult) => (
    option.kind !== 'bed' || option.id === selected?.id
    || (!suggestions.isLoading && suggestionsByBed.get(option.id)?.has_enough_area !== false)
  );
  const enabled = visible.filter(canChoose);
  const active = enabled.find((option) => resultId(option) === activeId) ?? enabled[0];
  const activeOptionId = active ? `${listId}-${resultId(active)}` : undefined;
  const activeAction = active?.kind !== 'bed' ? 'bedPicker.keyboardScope'
    : active.id === selected?.id ? 'bedPicker.keyboardKeep' : 'bedPicker.keyboardAssign';

  useEffect(() => {
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(initialQuery.length, initialQuery.length);
  }, [initialQuery]);

  useEffect(() => {
    const dismiss = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && !anchor.contains(target) && !popupRef.current?.contains(target)) {
        onClose(false);
      }
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [anchor, onClose]);

  useEffect(() => {
    const list = listRef.current;
    const option = activeOptionId ? document.getElementById(activeOptionId) : null;
    if (!list || !option) return;
    const viewport = list.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    if (row.top < viewport.top) list.scrollTop -= viewport.top - row.top;
    else if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom;
  }, [activeOptionId]);

  const changeScope = (next: BedPickerScope, clearQuery = false): void => {
    if (submittingRef.current) return;
    setScope(next);
    if (clearQuery) setQuery('');
    setActiveId(null);
    listRef.current?.scrollTo({ top: 0 });
    inputRef.current?.focus();
  };
  const removeScope = (): void => {
    changeScope(scope.fieldId !== null ? { locationId: scope.locationId, fieldId: null } : ALL_BEDS);
  };

  const pick = async (option: BedPickerResult): Promise<void> => {
    if (submittingRef.current || !canChoose(option)) return;
    if (option.kind !== 'bed') {
      changeScope({ locationId: option.locationId, fieldId: option.fieldId }, true);
      return;
    }
    if (option.id !== selected?.id) {
      submittingRef.current = true;
      setSubmitting(true);
      let saved: boolean;
      try {
        saved = await onSelect(option.id, suggestionsByBed.get(option.id)?.free_area_sqm ?? null);
      } catch {
        saved = false;
      }
      if (!saved) {
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }
    }
    const focused = document.activeElement;
    onClose(anchor.contains(focused) || Boolean(popupRef.current?.contains(focused)));
  };

  const focusPopupAction = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || event.shiftKey) return;
    const firstAction = popupRef.current?.querySelector<HTMLElement>('button:not([disabled]), a[href]');
    if (firstAction) {
      event.preventDefault();
      firstAction.focus();
    }
  };

  const handleInputKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab' && (!inScope || submitting)) {
      focusPopupAction(event);
    } else if (event.key === 'Backspace' && !query && inScope) {
      event.preventDefault();
      removeScope();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!active) return;
      const index = enabled.indexOf(active);
      const movement = event.key === 'ArrowDown' ? 1 : -1;
      const next = enabled[Math.max(0, Math.min(enabled.length - 1, index + movement))];
      setActiveId(resultId(next));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active) void pick(active);
    }
  };

  const conflictReason = (suggestion: BedSuggestion | undefined): string => {
    const finding = getPrimaryFinding(suggestion?.findings);
    if (suggestion?.status !== 'conflict' || !finding) return '';
    return t('bedPicker.conflictReason', {
      family: familyName(finding.family_key, finding.family_name),
      year: finding.earliest_year,
    });
  };

  return (
    <SearchHighlightContext.Provider value={terms}>
      <Box
        data-grid-dedicated-editor
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onClose(true);
          }
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!next || (!anchor.contains(next) && !popupRef.current?.contains(next))) {
            // Pointer interactions keep focus within the picker. Tab can leave it.
            onClose(false);
          }
        }}
        sx={{ width: '100%', minWidth: 0 }}
      >
        <InputBase
          fullWidth
          inputRef={inputRef}
          data-testid="inline-bed-picker"
          value={query}
          placeholder={t(scopeOption ? 'bedPicker.searchWithin' : 'bedPicker.search')}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(null);
            listRef.current?.scrollTo({ top: 0 });
          }}
          onKeyDown={handleInputKey}
          startAdornment={!scopeOption && <SearchIcon fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} />}
          endAdornment={scopeOption && (
            <Button
              onClick={removeScope}
              onMouseDown={(event) => event.preventDefault()}
              onKeyDown={focusPopupAction}
              aria-label={t('bedPicker.removeFilter', { name: scopeOption.name })}
              disabled={submitting}
              sx={{
                order: -1, flexShrink: 0, justifyContent: 'space-between', gap: 0.5, minWidth: 0, minHeight: 32,
                maxWidth: '56%', px: 0.75, py: 0.25, mr: 0.5, color: 'text.primary',
                bgcolor: 'action.selected', borderRadius: 1, textTransform: 'none',
                fontSize: '0.8125rem', fontWeight: 500, letterSpacing: 'normal',
                '@media (pointer: coarse)': { minHeight: 44 },
              }}
            >
              <Box id={scopeId} component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {scopeOption.name}
              </Box>
              <CloseIcon sx={{ fontSize: 16, flexShrink: 0 }} />
            </Button>
          )}
          slotProps={{ input: {
            role: 'combobox',
            'aria-label': t('bedPicker.search'),
            'aria-autocomplete': 'list',
            'aria-expanded': true,
            'aria-controls': listId,
            'aria-activedescendant': activeOptionId,
            'aria-describedby': scopeOption ? `${scopeId} ${hintId}` : hintId,
            readOnly: submitting,
          } }}
          sx={{
            px: 0.5, minHeight: 38, bgcolor: 'background.paper', border: 1,
            borderColor: 'divider', borderRadius: 1,
            '&.Mui-focused': { borderColor: 'primary.main' },
            '& .MuiInputBase-input': { flex: '1 1 0%', minWidth: 0, textOverflow: 'ellipsis' },
            '& .MuiInputBase-input::placeholder': { fontSize: '0.8125rem' },
          }}
        />
        <Popper
          anchorEl={anchor}
          data-grid-view-control
          role="presentation"
          open
          placement="bottom-start"
          ref={popupRef}
          modifiers={[{ name: 'preventOverflow', options: { padding: 12 } }]}
          sx={{ zIndex: (theme) => theme.zIndex.modal - 1, width: 'min(460px, calc(100vw - 24px))' }}
        >
          <Paper elevation={8} sx={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'min(390px, 56dvh)' }}>
            <Box
              id={listId}
              ref={listRef}
              component="ul"
              role="listbox"
              aria-label={t('bedPicker.results')}
              aria-busy={suggestions.isLoading || submitting}
              sx={{ overflowY: 'auto', m: 0, p: 0.5, listStyle: 'none', overscrollBehavior: 'contain' }}
            >
              {visible.map((option) => {
                const bed = option.kind === 'bed';
                const suggestion = bed ? suggestionsByBed.get(option.id) : undefined;
                const reason = conflictReason(suggestion);
                const disabled = !canChoose(option);
                const selectedBed = bed && option.id === selected?.id;
                const free = suggestion?.free_area_sqm ?? null;
                const needed = rotation.areaSqm;
                const insufficient = suggestion?.has_enough_area === false && free !== null && needed != null;
                const capacity = insufficient
                  ? t('bedPicker.insufficientArea', {
                    free: formatLocalizedNumber(free, numberLocale, { maximumFractionDigits: 2 }),
                    needed: formatLocalizedNumber(needed, numberLocale, { maximumFractionDigits: 2 }),
                  })
                  : suggestion && getBedCapacityText(suggestion, rotation.areaSqm, t, numberLocale, i18n.language);
                const blocker = insufficient ? suggestion.blocking_plan : null;
                const context = [
                  option.kind !== 'location' && scope.locationId === null ? option.locationName : '',
                  bed && scope.fieldId === null ? option.fieldName : '',
                ].filter(Boolean).join(BED_PATH_SEPARATOR);
                const Icon = icons[option.kind];
                const id = `${listId}-${resultId(option)}`;
                return (
                  <Box
                    component="li"
                    key={id}
                    id={id}
                    role="option"
                    aria-selected={selectedBed}
                    aria-disabled={disabled || undefined}
                    data-highlighted={option === active}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => { if (!disabled) setActiveId(resultId(option)); }}
                    onClick={() => void pick(option)}
                    sx={{
                      display: 'flex', alignItems: 'flex-start', gap: 1, minHeight: 44, px: 1,
                      py: 0.75, borderRadius: 0.5, cursor: disabled ? 'default' : 'pointer',
                      '&[data-highlighted="true"]': { bgcolor: 'action.selected' },
                    }}
                  >
                    <Icon fontSize="small" sx={{ mt: 0.25, color: 'text.secondary', flexShrink: 0 }} />
                    <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      <Typography variant="body2" sx={{ fontWeight: bed ? 400 : 600 }}>
                        <SearchHighlightedText text={option.name} />
                      </Typography>
                      {context && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          <SearchHighlightedText text={context} />
                        </Typography>
                      )}
                      {capacity && (
                        <Typography variant={insufficient ? 'body2' : 'caption'}
                          color={insufficient ? 'error.main' : 'text.secondary'}
                          sx={{ display: 'block', fontWeight: insufficient ? 600 : undefined }}>
                          {capacity}
                        </Typography>
                      )}
                      {blocker && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {t('bedPicker.occupiedUntil', {
                            culture: blocker.crop_label, date: formatIsoDate(blocker.end_date, i18n.language),
                          })}
                        </Typography>
                      )}
                      {reason && (
                        <Stack direction="row" sx={{ gap: 0.5, alignItems: 'center' }}>
                          <RotationStatusIcon status="conflict" sx={{ fontSize: 15 }} />
                          <Typography variant="caption">{reason}</Typography>
                        </Stack>
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ maxWidth: '32%', overflowWrap: 'anywhere' }}>
                      {bed
                        ? option.areaSqm === null ? t('columns.bed') : formatAreaM2(option.areaSqm, numberLocale)
                        : t(option.kind === 'location' ? 'columns.location' : 'columns.field')}
                    </Typography>
                    {selectedBed && <CheckIcon sx={{ fontSize: 18, flexShrink: 0 }} color="success" />}
                  </Box>
                );
              })}
            </Box>
            {(!hasBeds || visible.length === 0) && (
              <Box sx={{ px: 1.5, py: 0.75 }}>
                <Typography variant="body2" role="status">
                  {!hasBeds ? t('bedPicker.emptyTitle')
                    : scopeOption ? t('bedPicker.noScopedMatches', { name: scopeOption.name })
                      : t('bedPicker.noMatches')}
                </Typography>
                {!hasBeds && (
                  <Link component={RouterLink} to="/app/fields-beds" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                    {t('bedPicker.openGrowingAreas')}
                  </Link>
                )}
                {outsideCount > 0 && (
                  <Button sx={touchButtonSx} onClick={() => changeScope(ALL_BEDS)} disabled={submitting}>
                    {t('bedPicker.showOutside', { count: outsideCount })}
                  </Button>
                )}
              </Box>
            )}
            {inScope && (
              <Button sx={{ ...touchButtonSx, alignSelf: 'flex-start', mx: 0.5 }}
                onClick={() => changeScope(ALL_BEDS)} disabled={submitting}>
                {t('bedPicker.searchAll')}
              </Button>
            )}
            <Box sx={{ px: 1.5, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
              {(suggestions.isLoading || suggestions.isError) && (
                <Typography variant="caption" color="text.secondary" role="status" sx={{ display: 'block' }}>
                  {t(suggestions.isLoading ? 'rotation.checking' : 'rotation.checkError')}
                </Typography>
              )}
              <Typography id={hintId} variant="caption" color="text.secondary">
                {[
                  t('bedPicker.keyboardMove'),
                  active && t(activeAction),
                  t('bedPicker.keyboardCancel'),
                  inScope && !query && t('bedPicker.keyboardRemoveScope'),
                ].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
          </Paper>
        </Popper>
      </Box>
    </SearchHighlightContext.Provider>
  );
}
