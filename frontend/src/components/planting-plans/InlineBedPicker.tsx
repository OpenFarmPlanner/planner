import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import { Box, Button, InputBase, Link, Paper, Popper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';

import type { BedSuggestion } from '../../api/types';
import { useTranslation } from '../../i18n';
import { formatAreaM2 } from '../../pages/plantingPlansUtils';
import { SearchHighlightedText } from '../../search/SearchHighlightedText';
import { tokenizeSearchQuery } from '../../search/searchText';
import { SearchHighlightContext } from '../../search/SearchHighlightContext';
import { ALL_BEDS, BED_PATH_SEPARATOR, isBedInScope, type BedPickerOption, type BedPickerScope } from './bedPickerOptions';
import { RotationStatusIcon } from './rotation/RotationStatusIcon';
import { getBedCapacityText, getPrimaryFinding } from './rotation/rotationCopy';
import { useFamilyNameResolver } from './rotation/useFamilyNameResolver';
import { useBedSuggestions, type RotationInput } from './rotation/useRotationQueries';

interface InlineBedPickerProps {
  anchor: HTMLElement;
  initialQuery: string;
  options: BedPickerOption[];
  selected: BedPickerOption | undefined;
  rotation: RotationInput;
  numberLocale: string;
  onClose: (restoreFocus: boolean) => void;
  onSelect: (bedId: number, freeAreaSqm: number | null) => Promise<boolean>;
}

const touchButtonSx = { minHeight: 44, minWidth: 44, maxWidth: '100%', overflowWrap: 'anywhere', textTransform: 'none' } as const;
const chipSx = { px: 1.25, py: 0.5, maxWidth: '100%', overflowWrap: 'anywhere', bgcolor: 'action.selected', color: 'text.primary', borderRadius: 5 } as const;

function childGroups(options: BedPickerOption[]): Map<number, BedPickerOption[]> {
  const groups = new Map<number, BedPickerOption[]>();
  for (const option of options) {
    const group = groups.get(option.fieldId);
    if (group) group.push(option);
    else groups.set(option.fieldId, [option]);
  }
  return groups;
}

export function InlineBedPicker({ anchor, initialQuery, options, selected, rotation, numberLocale, onClose, onSelect }: InlineBedPickerProps) {
  const { t, i18n } = useTranslation('plantingPlans');
  const familyName = useFamilyNameResolver();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const keyboardMoveRef = useRef(false);
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<BedPickerScope>(selected ?? ALL_BEDS);
  const [activeId, setActiveId] = useState<number | null>(initialQuery ? null : selected?.id ?? null);
  const [submitting, setSubmitting] = useState(false);
  const terms = useMemo(() => tokenizeSearchQuery(query), [query]);
  const matches = useMemo(() => options.filter((option) => terms.every((term) => option.searchText.includes(term))), [options, terms]);
  const visible = useMemo(() => matches.filter((option) => isBedInScope(option, scope)), [matches, scope]);
  const groups = useMemo(() => childGroups(visible), [visible]);
  const outsideCount = matches.length - visible.length;
  const scopeOption = options.find((option) => isBedInScope(option, scope));
  const scopeName = scope.fieldId !== null ? scopeOption?.fieldName : scopeOption?.locationName;
  const inScope = scope.locationId !== null;
  const suggestions = useBedSuggestions(rotation, options.length > 0);
  const suggestionsByBed = useMemo(() => new Map(
    suggestions.data?.results.map((suggestion) => [suggestion.bed_id, suggestion]) ?? [],
  ), [suggestions.data]);
  const canChoose = (option: BedPickerOption) => (
    option.id === selected?.id
    || (!suggestions.isLoading && suggestionsByBed.get(option.id)?.has_enough_area !== false)
  );
  const enabled = visible.filter(canChoose);
  const active = enabled.find((option) => option.id === activeId) ?? enabled[0];
  const activeOptionId = active ? `${listId}-${active.id}` : undefined;

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
    if (keyboardMoveRef.current && activeOptionId) {
      document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
      keyboardMoveRef.current = false;
    }
  }, [activeOptionId]);

  const changeScope = (next: BedPickerScope): void => {
    setScope(next);
    setActiveId(null);
    inputRef.current?.focus();
  };

  const pick = async (option: BedPickerOption): Promise<void> => {
    if (submitting || !canChoose(option)) return;
    if (option.id !== selected?.id) {
      setSubmitting(true);
      let saved: boolean;
      try {
        saved = await onSelect(option.id, suggestionsByBed.get(option.id)?.free_area_sqm ?? null);
      } catch {
        saved = false;
      }
      if (!saved) {
        setSubmitting(false);
        return;
      }
    }
    const focused = document.activeElement;
    onClose(anchor.contains(focused) || Boolean(popupRef.current?.contains(focused)));
  };

  const handleInputKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab' && !event.shiftKey) {
      const firstAction = popupRef.current?.querySelector<HTMLElement>('button:not([disabled]), a[href]');
      if (firstAction) {
        event.preventDefault();
        firstAction.focus();
      }
    } else if (event.key === 'Backspace' && !query && inScope) {
      event.preventDefault();
      changeScope(scope.fieldId !== null ? { ...scope, fieldId: null } : ALL_BEDS);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!active) return;
      const index = enabled.indexOf(active);
      const movement = event.key === 'ArrowDown' ? 1 : -1;
      keyboardMoveRef.current = true;
      setActiveId(enabled[Math.max(0, Math.min(enabled.length - 1, index + movement))].id);
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
          placeholder={t('bedPicker.search')}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(null);
          }}
          onKeyDown={handleInputKey}
          startAdornment={<SearchIcon fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} />}
          slotProps={{ input: {
            role: 'combobox',
            'aria-label': t('bedPicker.search'),
            'aria-autocomplete': 'list',
            'aria-expanded': true,
            'aria-controls': listId,
            'aria-activedescendant': activeOptionId,
            readOnly: submitting,
          } }}
        />
        <Popper
          anchorEl={anchor}
          data-grid-view-control
          open
          placement="bottom-start"
          ref={popupRef}
          modifiers={[{ name: 'preventOverflow', options: { padding: 12 } }]}
          sx={{ zIndex: (theme) => theme.zIndex.modal - 1, width: 'min(460px, calc(100vw - 24px))' }}
        >
          <Paper elevation={8} sx={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'min(390px, 56dvh)' }}>
            {inScope && scopeOption && (
              <Stack direction="row" sx={{ px: 1, gap: 0.5, alignItems: 'center', flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
                {scope.fieldId !== null && (
                  <Typography variant="body2" sx={chipSx}><SearchHighlightedText text={scopeOption.locationName} /></Typography>
                )}
                <Button
                  onClick={() => changeScope(scope.fieldId === null ? ALL_BEDS : { ...scope, fieldId: null })}
                  aria-label={t('bedPicker.removeFilter', { name: scopeName })}
                  sx={{ ...touchButtonSx, p: 0, borderRadius: 5 }}
                >
                  <Box sx={{ ...chipSx, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <SearchHighlightedText text={scopeName ?? ''} />
                    <CloseIcon sx={{ fontSize: 16, flexShrink: 0 }} />
                  </Box>
                </Button>
              </Stack>
            )}
            <Box
              id={listId}
              component="ul"
              role="listbox"
              aria-label={t('columns.bed')}
              aria-busy={suggestions.isLoading || submitting}
              sx={{ overflowY: 'auto', m: 0, p: 0.5, listStyle: 'none', overscrollBehavior: 'contain' }}
            >
              {Array.from(groups, ([fieldId, group]) => {
                const { locationId, locationName, fieldName } = group[0];
                const headerId = `${listId}-field-${fieldId}`;
                return (
                  <Box component="li" role="presentation" key={fieldId}>
                    {scope.fieldId === null && (
                      <Stack id={headerId} direction="row" sx={{ px: 0.5, alignItems: 'center', flexWrap: 'wrap', bgcolor: 'action.hover' }}>
                        {!inScope && (
                          <Fragment>
                            <Button size="small" sx={touchButtonSx} onClick={() => changeScope({ locationId, fieldId: null })}>
                              <SearchHighlightedText text={locationName} />
                            </Button>
                            <Box component="span" aria-hidden>{BED_PATH_SEPARATOR.trim()}</Box>
                          </Fragment>
                        )}
                        <Button size="small" sx={touchButtonSx} onClick={() => changeScope({ locationId, fieldId })}>
                          <SearchHighlightedText text={fieldName} />
                        </Button>
                      </Stack>
                    )}
                    <Box
                      component="ul"
                      role="group"
                      aria-labelledby={scope.fieldId === null ? headerId : undefined}
                      aria-label={scope.fieldId !== null ? `${locationName}${BED_PATH_SEPARATOR}${fieldName}` : undefined}
                      sx={{ m: 0, p: 0, listStyle: 'none' }}
                    >
                      {group.map((option) => {
                        const suggestion = suggestionsByBed.get(option.id);
                        const reason = conflictReason(suggestion);
                        const capacity = suggestion && getBedCapacityText(suggestion, rotation.areaSqm, t, numberLocale, i18n.language);
                        const disabled = !canChoose(option);
                        return (
                          <Box
                            component="li"
                            key={option.id}
                            id={`${listId}-${option.id}`}
                            role="option"
                            aria-selected={option.id === selected?.id}
                            aria-disabled={disabled || undefined}
                            data-highlighted={option.id === active?.id}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseMove={() => { if (!disabled) setActiveId(option.id); }}
                            onClick={() => void pick(option)}
                            sx={{
                              display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, px: 1,
                              py: 0.5, borderRadius: 0.5, cursor: disabled ? 'default' : 'pointer',
                              '&[data-highlighted="true"]': { bgcolor: 'action.selected' },
                              '&[aria-disabled="true"]': { color: 'text.disabled' },
                            }}
                          >
                            <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                              <Typography variant="body2"><SearchHighlightedText text={option.name} /></Typography>
                              {reason && (
                                <Stack direction="row" sx={{ gap: 0.5, alignItems: 'center' }}>
                                  <RotationStatusIcon status="conflict" sx={{ fontSize: 15 }} />
                                  <Typography variant="caption">{reason}</Typography>
                                </Stack>
                              )}
                              {capacity && (
                                <Typography variant="caption" color={disabled ? 'inherit' : 'text.secondary'} sx={{ display: 'block' }}>{capacity}</Typography>
                              )}
                            </Box>
                            <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                              {option.areaSqm === null ? '—' : formatAreaM2(option.areaSqm, numberLocale)}
                            </Typography>
                            <Box sx={{ display: 'flex', width: 18 }}>
                              {option.id === selected?.id && <CheckIcon sx={{ fontSize: 18 }} color="success" />}
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                );
              })}
            </Box>
            {visible.length === 0 && (
              <Box sx={{ px: 1.5, py: 0.75 }}>
                <Typography variant="body2" role="status">
                  {options.length === 0 ? t('bedPicker.emptyTitle')
                    : scopeName && inScope ? t('bedPicker.noScopedMatches', { name: scopeName })
                      : t('bedPicker.noMatches')}
                </Typography>
                {options.length === 0 && (
                  <Link component={RouterLink} to="/app/fields-beds" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                    {t('bedPicker.openGrowingAreas')}
                  </Link>
                )}
                {outsideCount > 0 && (
                  <Button sx={touchButtonSx} onClick={() => changeScope(ALL_BEDS)}>
                    {t('bedPicker.showOutside', { count: outsideCount })}
                  </Button>
                )}
              </Box>
            )}
            {inScope && (
              <Button sx={{ ...touchButtonSx, alignSelf: 'flex-start', mx: 0.5 }} onClick={() => changeScope(ALL_BEDS)}>
                {t('bedPicker.searchAll')}
              </Button>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
              {suggestions.isLoading ? t('rotation.checking')
                : suggestions.isError ? t('rotation.checkError') : t('bedPicker.keyboardHint')}
            </Typography>
          </Paper>
        </Popper>
      </Box>
    </SearchHighlightContext.Provider>
  );
}
