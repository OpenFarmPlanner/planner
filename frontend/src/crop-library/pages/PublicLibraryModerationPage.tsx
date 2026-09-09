import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
  PublicLibraryModeratorRequest,
} from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import PageContainer from '../../components/layout/PageContainer';
import PageHeader from '../../components/layout/PageHeader';
import { useTranslation } from '../../i18n';
import { showGlobalSnackbar } from '../../utils/globalSnackbar';
import { resolveLocaleFromLanguage } from '../../utils/numberLocalization';
import { DisabledActionTooltip } from '../../components/DisabledActionTooltip';

type RequiredSpeciesLanguage = 'de' | 'en';
type SpeciesApprovalTranslations = Record<RequiredSpeciesLanguage, string>;

const REQUIRED_SPECIES_LANGUAGES: RequiredSpeciesLanguage[] = ['de', 'en'];
const ALIAS_SEARCH_DEBOUNCE_MS = 250;
const ALIAS_SPECIES_PAGE_SIZE = 20;

const parseAliasInput = (value: string): string[] => {
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const entry of value.split(',')) {
    const alias = entry.split(/\s+/).filter(Boolean).join(' ');
    const key = alias.toLocaleLowerCase('de');
    if (alias && !seen.has(key)) {
      aliases.push(alias);
      seen.add(key);
    }
  }
  return aliases;
};

const getSpeciesAliases = (species: CropSpecies, languageCode: string): string[] => (
  species.translations?.find((translation) => translation.language_code === languageCode)?.synonyms ?? []
);


export default function PublicLibraryModerationPage() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation('crops');
  const [speciesProposals, setSpeciesProposals] = useState<CropSpecies[]>([]);
  const [moderatorRequests, setModeratorRequests] = useState<PublicLibraryModeratorRequest[]>([]);
  const [removedCrops, setRemovedCrops] = useState<PublicCrop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [approvalProposal, setApprovalProposal] = useState<CropSpecies | null>(null);
  const [approvalTranslations, setApprovalTranslations] = useState<SpeciesApprovalTranslations>({ de: '', en: '' });
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

  const getInitialApprovalTranslations = (proposal: CropSpecies): SpeciesApprovalTranslations => {
    const translations: SpeciesApprovalTranslations = { de: '', en: '' };
    for (const translation of proposal.translations ?? []) {
      if (translation.language_code === 'de' || translation.language_code === 'en') {
        translations[translation.language_code] = translation.common_name;
      }
    }
    if (!translations.de && !translations.en) {
      const fallbackLanguage = proposal.display_language_code === 'de' || proposal.display_language_code === 'en'
        ? proposal.display_language_code
        : i18n.resolvedLanguage === 'de' ? 'de' : 'en';
      translations[fallbackLanguage] = proposal.display_name || proposal.name;
    }
    return translations;
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
      if (canManageRequests) {
        const requestsResponse = await publicLibraryModeratorRequestAPI.list({ status: 'pending' });
        setModeratorRequests(requestsResponse.data.results);
      } else {
        setModeratorRequests([]);
      }
      const removedResponse = await publicCropAPI.list({ status: 'removed' });
      setRemovedCrops(removedResponse.data.results);
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
    setApprovalTranslations(getInitialApprovalTranslations(proposal));
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
        REQUIRED_SPECIES_LANGUAGES.map((languageCode) => ({
          language_code: languageCode,
          common_name: approvalTranslations[languageCode].trim(),
        })),
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

  const canApproveSpecies = REQUIRED_SPECIES_LANGUAGES.every((languageCode) => approvalTranslations[languageCode].trim());

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
        synonyms: parseAliasInput(aliasDraft[translation.language_code] ?? ''),
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
            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 1 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1.5,
                alignItems: "center", }}  >
                <GavelOutlinedIcon color="primary" />
                <Typography variant="h6">{t('library.moderation.species.title')}</Typography>
              </Stack>
              {speciesProposals.length === 0 ? (
                <Typography color="text.secondary">{t('library.moderation.species.empty')}</Typography>
              ) : (
                <TableContainer>
                  <Table size="small" aria-label={t('library.moderation.species.title')}>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('library.moderation.columns.name')}</TableCell>
                        <TableCell>{t('library.moderation.columns.proposer')}</TableCell>
                        <TableCell>{t('library.moderation.columns.similar')}</TableCell>
                        <TableCell align="right">{t('library.moderation.columns.actions')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {speciesProposals.map((proposal) => (
                        <TableRow key={proposal.id}>
                          <TableCell>{proposal.name}</TableCell>
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
                        const aliases = REQUIRED_SPECIES_LANGUAGES.flatMap(
                          (languageCode) => getSpeciesAliases(species, languageCode),
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
      <Dialog open={Boolean(approvalProposal)} onClose={closeSpeciesApproval} maxWidth="sm" fullWidth>
        <DialogTitle>{t('library.moderation.species.approveDialogTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t('library.moderation.species.approveDialogIntro', { name: approvalProposal?.name ?? '' })}
            </Typography>
            <TextField
              label={t('library.moderation.species.germanName')}
              value={approvalTranslations.de}
              required
              fullWidth
              onChange={(event) => setApprovalTranslations((previous) => ({ ...previous, de: event.target.value }))}
            />
            <TextField
              label={t('library.moderation.species.englishName')}
              value={approvalTranslations.en}
              required
              fullWidth
              onChange={(event) => setApprovalTranslations((previous) => ({ ...previous, en: event.target.value }))}
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
                  language: translation.language_code === 'de'
                    ? t('library.moderation.speciesAliases.languageDe')
                    : t('library.moderation.speciesAliases.languageEn'),
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
