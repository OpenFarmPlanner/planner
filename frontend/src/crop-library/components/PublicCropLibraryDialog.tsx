import { alpha } from '@mui/material/styles';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from '../../i18n';
import type { PublicCrop } from '../../api/types';
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import TuneIcon from '@mui/icons-material/Tune';
import SpaOutlinedIcon from '@mui/icons-material/SpaOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
// Cross-domain import: a markdown helper that today lives under the
// app-specific data-grid module. Kept as-is rather than duplicated/moved —
// see docs/crop-library-architecture.md for why this is flagged as a
// future cleanup candidate rather than fixed now.
import { stripCitationMarkers } from '../../components/data-grid/markdown';
import { markdownComponents } from '../../components/data-grid/markdownComponents';
import { useOverlayHistory } from '../../hooks/useOverlayHistory';
import { PublicCropHierarchyList } from '../../crops/PublicCropHierarchyList';
import { getPublicCropTitle } from '../publicCropDisplay';
import { PublicCropFiltersPopover } from './PublicCropFiltersPopover';
import {
  EMPTY_PUBLIC_CROP_FILTERS,
  countActivePublicCropFilters,
  getPublicCropFilterOptions,
  matchesPublicCropFilters,
  type PublicCropFilterState,
} from '../publicCropFilters';

interface PublicCropLibraryDialogProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  crops: PublicCrop[];
  importingId: number | null;
  initialSelectedId?: number | null;
  initialQuery?: string;
  onClose: () => void;
  onSearch: (query: string) => void;
  onImport: (crop: PublicCrop) => void;
}

const previewBadgeSx = {
  height: 22,
  color: 'text.secondary',
  borderColor: 'divider',
  fontSize: '0.72rem',
} as const;

const PUBLIC_CROP_LIBRARY_HISTORY_KEY = 'openFarmPlannerPublicCropLibrary';

function LibraryEmptyState({
  title,
  description,
  secondaryDescription,
  secondaryDescriptionAriaLabel,
  compact = false,
}: {
  title: string;
  description: ReactNode;
  secondaryDescription?: ReactNode;
  secondaryDescriptionAriaLabel?: string;
  compact?: boolean;
}) {
  return (
    <Box
      sx={{
        height: '100%',
        minHeight: compact ? 180 : 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        px: compact ? 2 : 3,
        py: compact ? 3 : 4,
      }}
    >
      <Box
        sx={{
          width: compact ? 40 : 48,
          height: compact ? 40 : 48,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: compact ? 1.25 : 1.5,
          color: 'success.main',
          bgcolor: 'success.50',
          border: '1px solid',
          borderColor: 'success.200',
        }}
      >
        <SpaOutlinedIcon fontSize={compact ? 'small' : 'medium'} />
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.75, color: 'text.primary', textWrap: 'balance' }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: compact ? 360 : 420, lineHeight: 1.6 }}>
        {description}
      </Typography>
      {secondaryDescription ? (
        <Typography
          variant="caption"
          color="text.secondary"
          aria-label={secondaryDescriptionAriaLabel}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: 0.5,
            maxWidth: compact ? 360 : 420,
            mt: 1.25,
            lineHeight: 1.5,
          }}
        >
          {secondaryDescription}
        </Typography>
      ) : null}
    </Box>
  );
}

export function PublicCropLibraryDialog({
  open,
  loading,
  error,
  crops,
  importingId,
  initialSelectedId = null,
  initialQuery = '',
  onClose,
  onSearch,
  onImport,
}: PublicCropLibraryDialogProps) {
  const { t, i18n } = useTranslation('crops');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isSpeciesView, setIsSpeciesView] = useState(false);
  const [filters, setFilters] = useState<PublicCropFilterState>(EMPTY_PUBLIC_CROP_FILTERS);
  const [filterAnchorEl, setFilterAnchorEl] = useState<HTMLElement | null>(null);
  const isFilterPopoverOpen = Boolean(filterAnchorEl);
  const activeFilterCount = countActivePublicCropFilters(filters);
  const [mobileStep, setMobileStep] = useState<'list' | 'detail'>('list');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const useMobileFilterLayout = useMediaQuery(theme.breakpoints.down('md'));
  const closeDialog = useCallback((): void => {
    onClose();
  }, [onClose]);

  useOverlayHistory({
    open,
    onClose,
    historyKey: PUBLIC_CROP_LIBRARY_HISTORY_KEY,
    enabled: useMobileFilterLayout,
  });

  useEffect(() => {
    if (open) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) {
          return;
        }
        setQuery(initialQuery);
        setSelectedId(initialSelectedId);
        setIsSpeciesView(false);
        setFilters(EMPTY_PUBLIC_CROP_FILTERS);
        setFilterAnchorEl(null);
        setMobileStep(initialSelectedId && useMobileFilterLayout ? 'detail' : 'list');
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [initialQuery, initialSelectedId, open, useMobileFilterLayout]);

  useEffect(() => {
    if (!open) {
      queueMicrotask(() => {
        setQuery('');
        setSelectedId(null);
        setIsSpeciesView(false);
        setFilters(EMPTY_PUBLIC_CROP_FILTERS);
        setFilterAnchorEl(null);
        setMobileStep('list');
      });
    }
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const filterOptions = useMemo(() => getPublicCropFilterOptions(crops), [crops]);

  const filteredCrops = useMemo(() => crops.filter((entry) => {
    const label = [
      getPublicCropTitle(entry, language, t('library.translation.missingName')),
      entry.name,
      entry.variety || '',
      entry.crop_species_name || '',
      entry.crop_family || '',
    ].join(' ').toLowerCase();
    const matchesQuery = normalizedQuery.length === 0 || label.includes(normalizedQuery);
    return matchesQuery && matchesPublicCropFilters(entry, filters);
  }), [crops, filters, language, normalizedQuery, t]);

  useEffect(() => {
    if (loading || (initialSelectedId && selectedId === initialSelectedId && crops.length === 0)) {
      return;
    }
    if (!selectedId || filteredCrops.some((entry) => entry.id === selectedId)) {
      return undefined;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      setSelectedId((currentSelectedId) => (currentSelectedId === selectedId ? null : currentSelectedId));
    });
    return () => {
      cancelled = true;
    };
  }, [crops.length, filteredCrops, initialSelectedId, loading, selectedId]);

  const selectedCrop = useMemo(
    () => filteredCrops.find((entry) => entry.id === selectedId) ?? null,
    [filteredCrops, selectedId],
  );

  const selectCropFromList = useCallback((crop: PublicCrop, kind: 'species' | 'variety'): void => {
    setSelectedId(crop.id);
    setIsSpeciesView(kind === 'species');
    if (useMobileFilterLayout) {
      setMobileStep('detail');
    }
  }, [useMobileFilterLayout]);

  const hasLibraryEntries = crops.length > 0;
  const listEmptyTitle = hasLibraryEntries ? t('library.emptyState.noResultsTitle') : t('library.emptyState.emptyLibraryTitle');
  const listEmptyDescription = hasLibraryEntries ? t('library.empty') : t('library.emptyState.emptyLibraryDescription');
  const detailEmptyTitle = hasLibraryEntries ? t('library.emptyState.noSelectionTitle') : t('library.emptyState.emptyLibraryTitle');
  const detailEmptyDescription = hasLibraryEntries ? t('library.importDialog.emptyMotivation') : t('library.emptyState.emptyLibraryDescription');
  const detailEmptySecondaryDescription = hasLibraryEntries ? (
    <>
      <Box component="strong" sx={{ fontWeight: 700, color: 'text.primary' }}>
        {t('library.importDialog.emptyInstructionStep')}
      </Box>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
        {t('library.importDialog.emptyInstructionContext')}
      </Box>
      <Box
        component="span"
        aria-hidden="true"
        sx={{
          width: 24,
          height: 24,
          borderRadius: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          verticalAlign: 'middle',
          boxShadow: 1,
        }}
      >
        <MoreVertIcon sx={{ fontSize: 18 }} />
      </Box>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
        {t('library.importDialog.emptyInstructionAction')}
      </Box>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
        <Box component="span" aria-hidden="true">→</Box>
        <Box component="strong" sx={{ fontWeight: 700, color: 'text.primary' }}>
          {t('library.publishButton')}
        </Box>
      </Box>
    </>
  ) : undefined;
  const detailEmptySecondaryDescriptionAriaLabel = hasLibraryEntries
    ? t('library.importDialog.emptyInstructionAria', { publish: t('library.publishButton') })
    : undefined;

  const handleDialogClose = (): void => {
    if (useMobileFilterLayout && mobileStep === 'detail') {
      setMobileStep('list');
      return;
    }
    closeDialog();
  };

  const mobilePaperSx = useMobileFilterLayout
    ? {
      width: '100vw',
      maxWidth: '100vw',
      height: '100dvh',
      maxHeight: '100dvh',
      m: 0,
      bgcolor: 'background.paper',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      '@supports not (height: 100dvh)': {
        height: '100svh',
        maxHeight: '100svh',
      },
    }
    : undefined;

  return (
    <Dialog
    open={open}
    onClose={handleDialogClose}
    maxWidth={useMobileFilterLayout ? false : 'md'}
    fullWidth
    fullScreen={useMobileFilterLayout}
    slotProps={{
      paper: {
        sx: mobilePaperSx,
      },
    }}
  >
      <DialogTitle sx={{ py: 2, px: useMobileFilterLayout ? 1.5 : 3, flexShrink: 0, bgcolor: 'background.paper' }}>
        {t('library.dialogTitle')}
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          minHeight: useMobileFilterLayout ? 0 : 560,
          px: useMobileFilterLayout ? 1.25 : 3,
          py: 2,
          display: 'flex',
          flexDirection: 'column',
          flex: useMobileFilterLayout ? '1 1 auto' : undefined,
          overflow: 'hidden',
          bgcolor: 'background.paper',
        }}
      >
        <TextField
          fullWidth
          label={t('library.searchLabel')}
          value={query}
          onChange={(event) => {
            const nextValue = event.target.value;
            setQuery(nextValue);
            onSearch(nextValue);
          }}
          size="medium"
          sx={{ mb: 2 }}
          slotProps={{
            input: {
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
              endAdornment: (
                <IconButton
                  size="small"
                  onClick={(event) => setFilterAnchorEl(event.currentTarget)}
                  aria-expanded={isFilterPopoverOpen}
                  aria-haspopup="dialog"
                  aria-controls={isFilterPopoverOpen ? 'public-crop-filters-popover' : undefined}
                  aria-label={t('filters.openAdvanced')}
                  sx={{ bgcolor: activeFilterCount > 0 ? 'action.selected' : 'transparent' }}
                >
                  <Badge color="primary" badgeContent={activeFilterCount > 0 ? activeFilterCount : null}>
                    <TuneIcon fontSize="small" />
                  </Badge>
                </IconButton>
              ),
            }
          }}
        />

        <PublicCropFiltersPopover
          anchorEl={filterAnchorEl}
          onClose={() => setFilterAnchorEl(null)}
          filters={filters}
          onFilterChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          options={filterOptions}
          onReset={() => {
            setFilters(EMPTY_PUBLIC_CROP_FILTERS);
            setFilterAnchorEl(null);
          }}
        />

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

        <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: useMobileFilterLayout ? '1fr' : { xs: '1fr', md: '1.2fr 1fr' }, gap: 2, minHeight: 0, flex: 1 }}>
          {loading ? (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', bgcolor: (theme) => alpha(theme.palette.background.paper, 0.6), zIndex: 1 }}>
              <CircularProgress />
            </Box>
          ) : null}
          {(!useMobileFilterLayout || mobileStep === 'list') ? (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, height: useMobileFilterLayout ? '100%' : 420, minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable' }}>
              <PublicCropHierarchyList
                crops={filteredCrops}
                selectedCropId={selectedId}
                isSpeciesView={isSpeciesView}
                storageKey="publicCropLibraryDialog"
                searchQuery={query}
                ariaLabel={t('library.dialogTitle')}
                onSelect={(crop, { kind }) => selectCropFromList(crop, kind)}
                emptyState={useMobileFilterLayout ? (
                  <LibraryEmptyState title={listEmptyTitle} description={listEmptyDescription} compact />
                ) : (
                  <Typography color="text.secondary" sx={{ p: 2 }}>{t('library.empty')}</Typography>
                )}
              />
            </Box>
          ) : null}

          {(!useMobileFilterLayout || mobileStep === 'detail') ? (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: useMobileFilterLayout ? 1.5 : 2, minHeight: useMobileFilterLayout ? '100%' : 420, maxHeight: useMobileFilterLayout ? 'none' : 420, overflowY: 'auto', scrollbarGutter: 'stable' }}>
            {selectedCrop ? (
              <>
                <Typography variant="h6" sx={{ lineHeight: 1.25 }}>
                  {getPublicCropTitle(selectedCrop, language, t('library.translation.missingName'))}
                </Typography>
                {selectedCrop.variety ? (
                  <Typography color="text.secondary" sx={{ mb: 0.75, lineHeight: 1.35 }}>{selectedCrop.variety}</Typography>
                ) : null}
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.25 }}>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${t('library.versionLabel')} ${selectedCrop.version}`}
                    sx={previewBadgeSx}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${t('library.createdByLabel')} ${selectedCrop.created_by_label || t('library.anonymousAuthor')}`}
                    sx={previewBadgeSx}
                  />
                </Box>
                <Box sx={{ display: 'grid', gap: 0.5, mb: selectedCrop.notes ? 1.5 : 0.75 }}>
                  <Typography variant="body2" sx={{ lineHeight: 1.35 }}>
                    <strong>{t('form.growthDurationDays')}:</strong> {selectedCrop.growth_duration_days ?? t('noData')}
                  </Typography>
                  <Typography variant="body2" sx={{ lineHeight: 1.35 }}>
                    <strong>{t('form.harvestDurationDays')}:</strong> {selectedCrop.harvest_duration_days ?? t('noData')}
                  </Typography>
                </Box>
                <Typography
                  variant="subtitle1"
                  component="h3"
                  sx={{
                    fontWeight: 600,
                    fontSize: useMobileFilterLayout ? '1rem' : '1.05rem',
                    lineHeight: 1.3,
                    mb: 0.75,
                  }}
                >
                  {t('form.notes')}
                </Typography>
                {selectedCrop.notes ? (
                  <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
                    <Box
                      sx={{
                        '& h3': { mt: 1.35, mb: 0.5, fontSize: '0.9rem' },
                        '& h3:first-of-type': { mt: 0.25 },
                        '& p': { mb: 0.75, lineHeight: 1.45 },
                        '& ul': { pl: 2.5, mb: 0.75 },
                        '& li': { mb: 0.25 },
                        '& a': { color: 'primary.main' },
                        '& em': { color: 'text.secondary' },
                        fontSize: '0.875rem',
                      }}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {stripCitationMarkers(selectedCrop.notes)}
                      </ReactMarkdown>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
                    <Typography variant="body2" color="text.secondary">{t('noData')}</Typography>
                  </Box>
                )}
              </>
            ) : (
              <LibraryEmptyState
                title={detailEmptyTitle}
                description={detailEmptyDescription}
                secondaryDescription={detailEmptySecondaryDescription}
                secondaryDescriptionAriaLabel={detailEmptySecondaryDescriptionAriaLabel}
              />
            )}
            </Box>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: isMobile ? 1.25 : useMobileFilterLayout ? 1.5 : 3, py: isMobile ? 1 : 1.5, flexShrink: 0, bgcolor: 'background.paper', gap: 1, flexWrap: 'wrap' }}>
        <Button component={RouterLink} to="/app/crop-library" onClick={closeDialog} sx={{ mr: 'auto' }}>
          {t('library.openFullPage')}
        </Button>
        <Button onClick={closeDialog}>{t('form.cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => selectedCrop && onImport(selectedCrop)}
          disabled={!selectedCrop || importingId === selectedCrop?.id}
        >
          {importingId === selectedCrop?.id ? t('library.importing') : t('library.importButton')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
