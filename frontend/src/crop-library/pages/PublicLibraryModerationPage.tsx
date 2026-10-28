import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CheckOutlinedIcon from '@mui/icons-material/CheckOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined';
import RestoreOutlinedIcon from '@mui/icons-material/RestoreOutlined';
import { cropSpeciesAPI, publicCropAPI, publicLibraryModeratorRequestAPI } from '../../api/api';
import type {
  CropSpecies,
  CropSpeciesTranslation,
  PublicCrop,
  PublicCropChangeProposal,
  PublicLibraryModeratorRequest,
} from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import PageContainer from '../../components/layout/PageContainer';
import PageHeader from '../../components/layout/PageHeader';
import { useTranslation } from '../../i18n';
import { getLanguageDisplayName, SUPPORTED_LANGUAGES } from '../../i18n/languages';
import { showGlobalSnackbar } from '../../utils/globalSnackbar';
import { resolveLocaleFromLanguage } from '../../utils/numberLocalization';
import { DisabledActionTooltip } from '../../components/DisabledActionTooltip';
import { ConfirmationDialog } from '../../components/feedback/ConfirmationDialog';
import ChangeProposalQueue from '../components/ChangeProposalQueue';
import { SpeciesApprovalFields } from '../components/SpeciesApprovalFields';
import {
  buildSpeciesApprovalPayload,
  createEmptySpeciesApprovalTranslations,
  getInitialSpeciesApprovalTranslations,
  isSpeciesApprovalComplete,
  parseSpeciesAliasInput,
  REQUIRED_SPECIES_LANGUAGES,
  type RequiredSpeciesLanguage,
  type SpeciesApprovalTranslation,
  type SpeciesApprovalTranslations,
} from '../../crops/cropSpeciesMatching';

const ALIAS_SEARCH_DEBOUNCE_MS = 250;
const ALIAS_SPECIES_PAGE_SIZE = 20;

/** Whether a proposal already has every required common name, i.e. can be approved as stored. */
const isSpeciesProposalComplete = (species: CropSpecies): boolean => REQUIRED_SPECIES_LANGUAGES.every(
  (languageCode) => species.translations?.some(
    (translation) => translation.language_code === languageCode && translation.common_name.trim(),
  ),
);

/** One chip per required language; a missing common name shows as a faded outline. */
function SpeciesLanguageChips({ species }: { species: CropSpecies }) {
  const { t, i18n } = useTranslation('crops');
  const present = new Set(
    (species.translations ?? [])
      .filter((translation) => translation.common_name.trim())
      .map((translation) => translation.language_code),
  );
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
      {REQUIRED_SPECIES_LANGUAGES.map((languageCode) => {
        const language = getLanguageDisplayName(languageCode, i18n.resolvedLanguage ?? i18n.language);
        const available = present.has(languageCode);
        return (
          <Chip
            key={languageCode}
            size="small"
            label={languageCode.toUpperCase()}
            variant={available ? 'filled' : 'outlined'}
            color={available ? 'success' : 'default'}
            title={available ? language : t('library.moderation.species.languageMissing', { language })}
            aria-label={available ? language : t('library.moderation.species.languageMissing', { language })}
            sx={available ? undefined : { opacity: 0.6, borderStyle: 'dashed' }}
          />
        );
      })}
    </Stack>
  );
}

const getSpeciesAliases = (species: CropSpecies, languageCode: string): string[] => (
  species.translations?.find((translation) => translation.language_code === languageCode)?.synonyms ?? []
);


export default function PublicLibraryModerationPage() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation('crops');
  const [speciesProposals, setSpeciesProposals] = useState<CropSpecies[]>([]);
  const [selectedSpeciesIds, setSelectedSpeciesIds] = useState<Set<number>>(new Set());
  const [bulkApprovalOpen, setBulkApprovalOpen] = useState(false);
  const [moderatorRequests, setModeratorRequests] = useState<PublicLibraryModeratorRequest[]>([]);
  const [removedCrops, setRemovedCrops] = useState<PublicCrop[]>([]);
  const [changeProposals, setChangeProposals] = useState<PublicCropChangeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [approvalProposal, setApprovalProposal] = useState<CropSpecies | null>(null);
  const [approvalTranslations, setApprovalTranslations] = useState<SpeciesApprovalTranslations>(
    createEmptySpeciesApprovalTranslations,
  );
  const [aliasSearch, setAliasSearch] = useState('');
  const [aliasSpecies, setAliasSpecies] = useState<CropSpecies[]>([]);
  const [aliasLoading, setAliasLoading] = useState(false);
  const [aliasError, setAliasError] = useState('');
  const [aliasSpeciesEdit, setAliasSpeciesEdit] = useState<CropSpecies | null>(null);
  const [aliasDraft, setAliasDraft] = useState<Record<string, string>>({});

  const canModerate = Boolean(user?.is_public_library_moderator || user?.is_staff || user?.is_superuser);
  const canManageRequests = Boolean(user?.is_staff || user?.is_superuser);
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage);

  const formatDate = (value?: string | null): string => {
    if (!value) {
      return t('library.moderation.unknownDate');
    }
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
  };

  const loadQueues = useCallback(async (): Promise<void> => {
    if (!canModerate) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const speciesResponse = await cropSpeciesAPI.list({ status: 'proposed', include_proposed: true });
      setSpeciesProposals(speciesResponse.data.results);
      // Drop selections of proposals that are gone (approved, rejected) or
      // no longer complete, so the bulk action never acts on a stale row.
      setSelectedSpeciesIds((previous) => new Set(
        speciesResponse.data.results
          .filter((proposal) => previous.has(proposal.id) && isSpeciesProposalComplete(proposal))
          .map((proposal) => proposal.id),
      ));
      if (canManageRequests) {
        const requestsResponse = await publicLibraryModeratorRequestAPI.list({ status: 'pending' });
        setModeratorRequests(requestsResponse.data.results);
      } else {
        setModeratorRequests([]);
      }
      const removedResponse = await publicCropAPI.list({ status: 'removed' });
      setRemovedCrops(removedResponse.data.results);
      const proposalsResponse = await publicCropAPI.pendingChangeProposals();
      setChangeProposals(proposalsResponse.data.results);
    } catch {
      setError(t('library.moderation.loadError'));
    } finally {
      setLoading(false);
    }
  }, [canManageRequests, canModerate, t]);

  useEffect(() => {
    void loadQueues();
  }, [loadQueues]);

  const openSpeciesApproval = (proposal: CropSpecies): void => {
    setApprovalProposal(proposal);
    setApprovalTranslations(getInitialSpeciesApprovalTranslations(
      proposal, proposal.name, i18n.resolvedLanguage ?? i18n.language,
    ));
  };

  const closeSpeciesApproval = (): void => {
    if (busyAction !== null) return;
    setApprovalProposal(null);
  };

  const approveSpecies = async (): Promise<void> => {
    if (!approvalProposal) return;
    setBusyAction(`species-${approvalProposal.id}-approve`);
    try {
      await cropSpeciesAPI.approve(
        approvalProposal.id,
        '',
        buildSpeciesApprovalPayload(approvalTranslations),
      );
      showGlobalSnackbar({ message: t('library.moderation.species.approveSuccess'), severity: 'success' });
      setApprovalProposal(null);
      await loadQueues();
    } catch {
      showGlobalSnackbar({ message: t('library.moderation.actionError'), severity: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  const completeSpeciesProposals = speciesProposals.filter(isSpeciesProposalComplete);
  const selectedSpeciesProposals = speciesProposals.filter((proposal) => selectedSpeciesIds.has(proposal.id));
  const allCompleteSelected = completeSpeciesProposals.length > 0
    && completeSpeciesProposals.every((proposal) => selectedSpeciesIds.has(proposal.id));

  const toggleSpeciesSelection = (proposalId: number): void => {
    setSelectedSpeciesIds((previous) => {
      const next = new Set(previous);
      if (next.has(proposalId)) next.delete(proposalId);
      else next.add(proposalId);
      return next;
    });
  };

  const toggleAllSpeciesSelection = (): void => {
    setSelectedSpeciesIds(allCompleteSelected
      ? new Set()
      : new Set(completeSpeciesProposals.map((proposal) => proposal.id)));
  };

  /**
   * Approves the selected proposals one by one with their stored names,
   * synonyms and regional names — the same payload the single dialog would
   * send unchanged — so one failure (e.g. a duplicate name) never blocks the
   * others. Failed proposals stay selected for a retry or a closer look.
   */
  const approveSelectedSpecies = async (): Promise<void> => {
    setBulkApprovalOpen(false);
    setBusyAction('species-bulk-approve');
    const languageCode = i18n.resolvedLanguage ?? i18n.language;
    const failed: string[] = [];
    for (const proposal of selectedSpeciesProposals) {
      try {
        await cropSpeciesAPI.approve(
          proposal.id,
          '',
          buildSpeciesApprovalPayload(getInitialSpeciesApprovalTranslations(proposal, proposal.name, languageCode)),
        );
      } catch {
        failed.push(proposal.name);
      }
    }
    const approvedCount = selectedSpeciesProposals.length - failed.length;
    if (failed.length === 0) {
      showGlobalSnackbar({
        message: t('library.moderation.species.bulkApproveSuccess', { count: approvedCount }),
        severity: 'success',
      });
    } else {
      showGlobalSnackbar({
        message: t('library.moderation.species.bulkApprovePartial', {
          count: approvedCount, failed: failed.length, names: failed.join(', '),
        }),
        severity: 'error',
      });
    }
    await loadQueues();
    setBusyAction(null);
  };

  const reviewSpecies = async (proposal: CropSpecies, action: 'reject'): Promise<void> => {
    setBusyAction(`species-${proposal.id}-${action}`);
    try {
      await cropSpeciesAPI.reject(proposal.id);
      showGlobalSnackbar({ message: t(`library.moderation.species.${action}Success`), severity: 'success' });
      await loadQueues();
    } catch {
      showGlobalSnackbar({ message: t('library.moderation.actionError'), severity: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  const canApproveSpecies = isSpeciesApprovalComplete(approvalTranslations);

  const changeApprovalTranslation = (
    languageCode: RequiredSpeciesLanguage, patch: Partial<SpeciesApprovalTranslation>,
  ): void => {
    setApprovalTranslations((previous) => ({
      ...previous,
      [languageCode]: { ...previous[languageCode], ...patch },
    }));
  };

  const reviewModeratorRequest = async (request: PublicLibraryModeratorRequest, action: 'approve' | 'reject'): Promise<void> => {
    setBusyAction(`request-${request.id}-${action}`);
    try {
      if (action === 'approve') {
        await publicLibraryModeratorRequestAPI.approve(request.id);
      } else {
        await publicLibraryModeratorRequestAPI.reject(request.id);
      }
      showGlobalSnackbar({ message: t(`library.moderation.requests.${action}Success`), severity: 'success' });
      await loadQueues();
    } catch {
      showGlobalSnackbar({ message: t('library.moderation.actionError'), severity: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  const reviewChangeProposal = async (
    proposal: PublicCropChangeProposal,
    action: 'approve' | 'reject',
    reviewNote: string,
  ): Promise<void> => {
    setBusyAction(`proposal-${proposal.id}-${action}`);
    try {
      if (action === 'approve') {
        await publicCropAPI.approveChangeProposal(proposal.public_crop, proposal.id, reviewNote);
      } else {
        await publicCropAPI.rejectChangeProposal(proposal.public_crop, proposal.id, reviewNote);
      }
      showGlobalSnackbar({
        message: t(`library.moderation.contributions.${action}Success`),
        severity: 'success',
      });
      await loadQueues();
    } catch {
      showGlobalSnackbar({ message: t('library.moderation.actionError'), severity: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  const restoreCrop = async (crop: PublicCrop): Promise<void> => {
    const name = crop.variety ? `${crop.name} · ${crop.variety}` : crop.name;
    setBusyAction(`removed-${crop.id}-restore`);
    try {
      await publicCropAPI.restore(crop.id);
      showGlobalSnackbar({ message: t('library.moderation.removed.restoreSuccess', { name }), severity: 'success' });
      await loadQueues();
    } catch {
      showGlobalSnackbar({ message: t('library.moderation.removed.restoreError'), severity: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    if (!canModerate) return undefined;
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setAliasLoading(true);
      setAliasError('');
      cropSpeciesAPI.list({ q: aliasSearch.trim(), page_size: ALIAS_SPECIES_PAGE_SIZE })
        .then((response) => {
          if (cancelled) return;
          setAliasSpecies(response.data.results);
        })
        .catch(() => {
          if (cancelled) return;
          setAliasSpecies([]);
          setAliasError(t('library.moderation.speciesAliases.loadError'));
        })
        .finally(() => {
          if (!cancelled) setAliasLoading(false);
        });
    }, ALIAS_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [aliasSearch, canModerate, t]);

  const openAliasEditor = (species: CropSpecies): void => {
    setAliasSpeciesEdit(species);
    setAliasDraft(Object.fromEntries(
      (species.translations ?? []).map((translation) => [
        translation.language_code,
        (translation.synonyms ?? []).join(', '),
      ]),
    ));
  };

  const closeAliasEditor = (): void => {
    if (busyAction !== null) return;
    setAliasSpeciesEdit(null);
  };

  const saveAliases = async (): Promise<void> => {
    if (!aliasSpeciesEdit) return;
    // Every stored language is sent back: the API upserts translations, so a
    // language left out would keep its old aliases rather than be cleared.
    const translations: CropSpeciesTranslation[] = (aliasSpeciesEdit.translations ?? []).map(
      (translation) => ({
        language_code: translation.language_code,
        common_name: translation.common_name,
        synonyms: parseSpeciesAliasInput(aliasDraft[translation.language_code] ?? ''),
        regional_names: translation.regional_names ?? {},
      }),
    );
    setBusyAction(`alias-${aliasSpeciesEdit.id}-save`);
    try {
      const response = await cropSpeciesAPI.updateTranslations(aliasSpeciesEdit.id, translations);
      setAliasSpecies((previous) => previous.map(
        (item) => (item.id === response.data.id ? response.data : item),
      ));
      showGlobalSnackbar({
        message: t('library.moderation.speciesAliases.saveSuccess'),
        severity: 'success',
      });
      setAliasSpeciesEdit(null);
    } catch {
      showGlobalSnackbar({
        message: t('library.moderation.speciesAliases.saveError'),
        severity: 'error',
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (!canModerate) {
    return (
      <PageContainer>
        <Alert severity="warning">{t('library.moderation.forbidden')}</Alert>
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="wide">
      <Stack spacing={2.5}>
        <PageHeader title={t('library.moderation.title')} />
        {error ? <Alert severity="error">{error}</Alert> : null}
        {loading ? (
          <Box sx={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* First: this is the queue the proposal notifications link here
                for, so it must be what a moderator lands on. */}
            <ChangeProposalQueue
              proposals={changeProposals}
              loading={false}
              busyAction={busyAction}
              formatDate={formatDate}
              onReview={reviewChangeProposal}
            />

            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 1 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1.5,
                alignItems: "center", }}  >
                <GavelOutlinedIcon color="primary" />
                <Typography variant="h6">{t('library.moderation.species.title')}</Typography>
              </Stack>
              {speciesProposals.length > 0 ? (
                <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                  <DisabledActionTooltip
                    title={busyAction !== null
                      ? t('common:disabledReasons.busy')
                      : selectedSpeciesProposals.length === 0
                        ? t('library.moderation.species.bulkNoneSelected')
                        : ''}
                  >
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<CheckOutlinedIcon />}
                      disabled={busyAction !== null || selectedSpeciesProposals.length === 0}
                      onClick={() => setBulkApprovalOpen(true)}
                    >
                      {busyAction === 'species-bulk-approve'
                        ? t('library.moderation.saving')
                        : t('library.moderation.species.bulkApprove', { count: selectedSpeciesProposals.length })}
                    </Button>
                  </DisabledActionTooltip>
                  <Typography variant="body2" color="text.secondary">
                    {t('library.moderation.species.bulkHint')}
                  </Typography>
                </Stack>
              ) : null}
              {speciesProposals.length === 0 ? (
                <Typography color="text.secondary">{t('library.moderation.species.empty')}</Typography>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label={t('library.moderation.species.title')}>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={allCompleteSelected}
                            indeterminate={!allCompleteSelected && selectedSpeciesProposals.length > 0}
                            disabled={busyAction !== null || completeSpeciesProposals.length === 0}
                            onChange={toggleAllSpeciesSelection}
                            slotProps={{ input: { 'aria-label': t('library.moderation.species.bulkSelectAll') } }}
                          />
                        </TableCell>
                        <TableCell>{t('library.moderation.columns.name')}</TableCell>
                        <TableCell>{t('library.moderation.columns.languages')}</TableCell>
                        <TableCell>{t('library.moderation.columns.proposer')}</TableCell>
                        <TableCell>{t('library.moderation.columns.similar')}</TableCell>
                        <TableCell align="right">{t('library.moderation.columns.actions')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {speciesProposals.map((proposal) => (
                        <TableRow key={proposal.id} selected={selectedSpeciesIds.has(proposal.id)}>
                          <TableCell padding="checkbox">
                            <DisabledActionTooltip
                              title={isSpeciesProposalComplete(proposal)
                                ? ''
                                : t('library.moderation.species.bulkIncomplete')}
                            >
                              <Checkbox
                                checked={selectedSpeciesIds.has(proposal.id)}
                                disabled={busyAction !== null || !isSpeciesProposalComplete(proposal)}
                                onChange={() => toggleSpeciesSelection(proposal.id)}
                                slotProps={{
                                  input: { 'aria-label': t('library.moderation.species.bulkSelect', { name: proposal.name }) },
                                }}
                              />
                            </DisabledActionTooltip>
                          </TableCell>
                          <TableCell>
                            {proposal.name}
                            {proposal.scientific_name ? (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontStyle: 'italic' }}>
                                {proposal.scientific_name}
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <SpeciesLanguageChips species={proposal} />
                          </TableCell>
                          <TableCell>{proposal.proposed_by_label || t('library.anonymousAuthor')}</TableCell>
                          <TableCell>
                            {(proposal.similar_species ?? []).length > 0
                              ? proposal.similar_species?.map((item) => <Chip key={item.id} size="small" label={item.name} sx={{ mr: 0.5, mb: 0.5 }} />)
                              : t('library.moderation.none')}
                          </TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", }} >
                              <DisabledActionTooltip title={busyAction !== null ? t('common:disabledReasons.busy') : ''}>
                                <Button
                                  size="small"
                                  variant="contained"
                                  startIcon={<CheckOutlinedIcon />}
                                  disabled={busyAction !== null}
                                  onClick={() => openSpeciesApproval(proposal)}
                                >
                                  {busyAction === `species-${proposal.id}-approve` ? t('library.moderation.saving') : t('library.moderation.approve')}
                                </Button>
                              </DisabledActionTooltip>
                              <DisabledActionTooltip title={busyAction !== null ? t('common:disabledReasons.busy') : ''}>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="error"
                                  startIcon={<CloseOutlinedIcon />}
                                  disabled={busyAction !== null}
                                  onClick={() => void reviewSpecies(proposal, 'reject')}
                                >
                                  {t('library.moderation.reject')}
                                </Button>
                              </DisabledActionTooltip>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 1 }}>
              <Typography variant="h6" sx={{ mb: 0.5 }}>{t('library.moderation.speciesAliases.title')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t('library.moderation.speciesAliases.intro')}
              </Typography>
              <TextField
                label={t('library.moderation.speciesAliases.searchLabel')}
                helperText={t('library.moderation.speciesAliases.searchHint')}
                value={aliasSearch}
                size="small"
                fullWidth
                sx={{ mb: 1.5, maxWidth: { sm: 360 } }}
                onChange={(event) => setAliasSearch(event.target.value)}
              />
              {aliasError ? <Alert severity="error" sx={{ mb: 1.5 }}>{aliasError}</Alert> : null}
              {aliasLoading && aliasSpecies.length === 0 ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : aliasSpecies.length === 0 ? (
                <Typography color="text.secondary">{t('library.moderation.speciesAliases.empty')}</Typography>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label={t('library.moderation.speciesAliases.title')}>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('library.moderation.columns.name')}</TableCell>
                        <TableCell>{t('library.moderation.speciesAliases.column')}</TableCell>
                        <TableCell align="right">{t('library.moderation.columns.actions')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {aliasSpecies.map((species) => {
                        const aliases = SUPPORTED_LANGUAGES.flatMap(
                          ({ code }) => getSpeciesAliases(species, code),
                        );
                        return (
                          <TableRow key={species.id}>
                            <TableCell>{species.display_name || species.name}</TableCell>
                            <TableCell>
                              {aliases.length > 0
                                ? aliases.map((alias) => (
                                  <Chip key={alias} size="small" label={alias} sx={{ mr: 0.5, mb: 0.5 }} />
                                ))
                                : t('library.moderation.speciesAliases.none')}
                            </TableCell>
                            <TableCell align="right">
                              <DisabledActionTooltip title={busyAction !== null ? t('common:disabledReasons.busy') : ''}>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<EditOutlinedIcon />}
                                  disabled={busyAction !== null}
                                  onClick={() => openAliasEditor(species)}
                                >
                                  {t('library.moderation.speciesAliases.edit')}
                                </Button>
                              </DisabledActionTooltip>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>

            {canManageRequests ? (
              <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 1 }}>
                <Typography variant="h6" sx={{ mb: 1.5 }}>{t('library.moderation.requests.title')}</Typography>
                {moderatorRequests.length === 0 ? (
                  <Typography color="text.secondary">{t('library.moderation.requests.empty')}</Typography>
                ) : (
                  <TableContainer>
                    <Table size="small" aria-label={t('library.moderation.requests.title')}>
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('library.moderation.columns.user')}</TableCell>
                          <TableCell>{t('library.moderation.columns.motivation')}</TableCell>
                          <TableCell>{t('library.moderation.columns.date')}</TableCell>
                          <TableCell align="right">{t('library.moderation.columns.actions')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {moderatorRequests.map((request) => (
                          <TableRow key={request.id}>
                            <TableCell>{request.user_label}</TableCell>
                            <TableCell sx={{ maxWidth: 420, whiteSpace: 'pre-wrap' }}>{request.motivation}</TableCell>
                            <TableCell>{formatDate(request.created_at)}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", }} >
                                <DisabledActionTooltip title={busyAction !== null ? t('common:disabledReasons.busy') : ''}>
                                  <Button
                                    size="small"
                                    variant="contained"
                                    startIcon={<CheckOutlinedIcon />}
                                    disabled={busyAction !== null}
                                    onClick={() => void reviewModeratorRequest(request, 'approve')}
                                  >
                                    {busyAction === `request-${request.id}-approve` ? t('library.moderation.saving') : t('library.moderation.approve')}
                                  </Button>
                                </DisabledActionTooltip>
                                <DisabledActionTooltip title={busyAction !== null ? t('common:disabledReasons.busy') : ''}>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    color="error"
                                    startIcon={<CloseOutlinedIcon />}
                                    disabled={busyAction !== null}
                                    onClick={() => void reviewModeratorRequest(request, 'reject')}
                                  >
                                    {t('library.moderation.reject')}
                                  </Button>
                                </DisabledActionTooltip>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Paper>
            ) : null}

            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 1 }}>
              <Typography variant="h6" sx={{ mb: 1.5 }}>{t('library.moderation.removed.title')}</Typography>
              {removedCrops.length === 0 ? (
                <Typography color="text.secondary">{t('library.moderation.removed.empty')}</Typography>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label={t('library.moderation.removed.title')}>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('library.moderation.columns.name')}</TableCell>
                        <TableCell>{t('library.moderation.removed.reason')}</TableCell>
                        <TableCell>{t('library.moderation.columns.date')}</TableCell>
                        <TableCell align="right">{t('library.moderation.columns.actions')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {removedCrops.map((crop) => (
                        <TableRow key={crop.id}>
                          <TableCell>{crop.variety ? `${crop.name} · ${crop.variety}` : crop.name}</TableCell>
                          <TableCell>
                            {crop.removal_reason ? t(`library.removeReasons.${crop.removal_reason}`) : t('library.moderation.none')}
                          </TableCell>
                          <TableCell>{formatDate(crop.updated_at)}</TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", }} >
                              <DisabledActionTooltip title={busyAction !== null ? t('common:disabledReasons.busy') : ''}>
                                <Button
                                  size="small"
                                  variant="contained"
                                  startIcon={<RestoreOutlinedIcon />}
                                  disabled={busyAction !== null}
                                  onClick={() => void restoreCrop(crop)}
                                >
                                  {busyAction === `removed-${crop.id}-restore` ? t('library.moderation.saving') : t('library.moderation.removed.restore')}
                                </Button>
                              </DisabledActionTooltip>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>
          </>
        )}
      </Stack>
      <ConfirmationDialog
        open={bulkApprovalOpen}
        title={t('library.moderation.species.bulkConfirmTitle')}
        message={(
          <>
            {t('library.moderation.species.bulkConfirmMessage', { count: selectedSpeciesProposals.length })}
            <Box component="ul" sx={{ mt: 1, mb: 0, pl: 3, maxHeight: 280, overflowY: 'auto' }}>
              {selectedSpeciesProposals.map((proposal) => (
                <li key={proposal.id}>{proposal.name}</li>
              ))}
            </Box>
          </>
        )}
        messageTypographyProps={{ component: 'div' }}
        cancelLabel={t('library.moderation.cancel')}
        confirmLabel={t('library.moderation.approve')}
        onCancel={() => setBulkApprovalOpen(false)}
        onConfirm={() => void approveSelectedSpecies()}
        maxWidth="sm"
        fullWidth
      />
      <Dialog open={Boolean(approvalProposal)} onClose={closeSpeciesApproval} maxWidth="md" fullWidth>
        <DialogTitle>{t('library.moderation.species.approveDialogTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t('library.moderation.species.approveDialogIntro', { name: approvalProposal?.name ?? '' })}
            </Typography>
            {approvalProposal?.scientific_name || approvalProposal?.family ? (
              <Typography variant="body2" color="text.secondary">
                {[approvalProposal.scientific_name, approvalProposal.family].filter(Boolean).join(' · ')}
              </Typography>
            ) : null}
            <SpeciesApprovalFields
              translations={approvalTranslations}
              onChange={changeApprovalTranslation}
              disabled={busyAction !== null}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeSpeciesApproval} variant="outlined">{t('library.moderation.cancel')}</Button>
          <DisabledActionTooltip
            title={busyAction !== null
              ? t('common:disabledReasons.busy')
              : !canApproveSpecies
                ? t('disabledReasons.requiredSpeciesNames')
                : ''}
          >
            <Button
              onClick={() => void approveSpecies()}
              variant="contained"
              disabled={!canApproveSpecies || busyAction !== null}
            >
              {busyAction === `species-${approvalProposal?.id}-approve`
                ? t('library.moderation.saving')
                : t('library.moderation.approve')}
            </Button>
          </DisabledActionTooltip>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(aliasSpeciesEdit)} onClose={closeAliasEditor} maxWidth="sm" fullWidth>
        <DialogTitle>{t('library.moderation.speciesAliases.dialogTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t('library.moderation.speciesAliases.dialogIntro', {
                name: aliasSpeciesEdit?.display_name || aliasSpeciesEdit?.name || '',
              })}
            </Typography>
            {(aliasSpeciesEdit?.translations ?? []).map((translation) => (
              <TextField
                key={translation.language_code}
                label={t('library.moderation.speciesAliases.fieldLabel', {
                  language: getLanguageDisplayName(translation.language_code, i18n.resolvedLanguage ?? i18n.language),
                })}
                value={aliasDraft[translation.language_code] ?? ''}
                fullWidth
                onChange={(event) => setAliasDraft((previous) => ({
                  ...previous,
                  [translation.language_code]: event.target.value,
                }))}
              />
            ))}
            <Typography variant="body2" color="text.secondary">
              {t('library.moderation.speciesAliases.helperText')}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeAliasEditor} variant="outlined">{t('library.moderation.cancel')}</Button>
          <DisabledActionTooltip title={busyAction !== null ? t('common:disabledReasons.busy') : ''}>
            <Button
              onClick={() => void saveAliases()}
              variant="contained"
              disabled={busyAction !== null}
            >
              {busyAction === `alias-${aliasSpeciesEdit?.id}-save`
                ? t('library.moderation.saving')
                : t('library.moderation.speciesAliases.save')}
            </Button>
          </DisabledActionTooltip>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
