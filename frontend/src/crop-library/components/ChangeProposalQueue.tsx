import { useMemo, useState } from 'react';
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
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined';
import type { PublicCropChangeProposal } from '../../api/types';
import { AppTooltip } from '../../components/AppTooltip';
import { DisabledActionTooltip } from '../../components/DisabledActionTooltip';
import { useTranslation } from '../../i18n';
import type { TFunction } from 'i18next';
import { formatHistoryChangeValue, getCropFieldLabel } from '../../pages/cropsHistoryUtils';

/**
 * Keys the backend stores on a `new_publish` proposal to carry the approval
 * forward (which project crop it came from). They are plumbing, not proposed
 * values, so they never belong in the moderator's diff.
 */
const INTERNAL_PROPOSED_DATA_PREFIX = '_';

export interface ChangeProposalQueueProps {
  proposals: PublicCropChangeProposal[];
  loading: boolean;
  busyAction: string | null;
  formatDate: (value?: string | null) => string;
  onReview: (
    proposal: PublicCropChangeProposal,
    action: 'approve' | 'reject',
    reviewNote: string,
  ) => Promise<void>;
}

function OriginChips({ proposal, t }: { proposal: PublicCropChangeProposal; t: TFunction<'crops'> }) {
  if (!proposal.origin_api && !proposal.origin_declared_agent) return null;
  return (
    <>
      {proposal.origin_api ? (
        <Chip size="small" variant="outlined" label={t('library.moderation.contributions.origin.api')} />
      ) : null}
      {proposal.origin_declared_agent ? (
        <AppTooltip title={t('library.moderation.contributions.origin.agentTooltip')}>
          <Chip size="small" variant="outlined" label={t('library.moderation.contributions.origin.agent')} />
        </AppTooltip>
      ) : null}
    </>
  );
}

export default function ChangeProposalQueue({
  proposals,
  loading,
  busyAction,
  formatDate,
  onReview,
}: ChangeProposalQueueProps) {
  const { t } = useTranslation('crops');
  const [reviewing, setReviewing] = useState<PublicCropChangeProposal | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const proposedFields = useMemo(() => {
    if (!reviewing) return [];
    return Object.entries(reviewing.proposed_data ?? {})
      .filter(([field]) => !field.startsWith(INTERNAL_PROPOSED_DATA_PREFIX));
  }, [reviewing]);

  const openReview = (proposal: PublicCropChangeProposal): void => {
    setReviewing(proposal);
    setReviewNote('');
  };

  const closeReview = (): void => {
    if (busyAction !== null) return;
    setReviewing(null);
  };

  const review = async (action: 'approve' | 'reject'): Promise<void> => {
    if (!reviewing) return;
    await onReview(reviewing, action, reviewNote.trim());
    setReviewing(null);
  };

  const entryLabel = (proposal: PublicCropChangeProposal): string => (
    proposal.public_crop_label || String(proposal.public_crop)
  );

  const isNewPublish = reviewing?.kind === 'new_publish';

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 1 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {t('library.moderation.contributions.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('library.moderation.contributions.intro')}
      </Typography>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : proposals.length === 0 ? (
        <Typography color="text.secondary">
          {t('library.moderation.contributions.empty')}
        </Typography>
      ) : (
        <TableContainer>
          <Table
            size="small"
            aria-label={t('library.moderation.contributions.title')}
            // Recovers the last few pixels the action column needs at 375px.
            sx={{ '& .MuiTableCell-root': { px: { xs: 1, sm: 2 } } }}
          >
            <TableHead>
              <TableRow>
                <TableCell>{t('library.moderation.contributions.columns.entry')}</TableCell>
                <TableCell>{t('library.moderation.contributions.columns.kind')}</TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                  {t('library.moderation.columns.proposer')}
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                  {t('library.moderation.columns.date')}
                </TableCell>
                <TableCell align="right">{t('library.moderation.columns.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {proposals.map((proposal) => (
                <TableRow key={proposal.id}>
                  <TableCell>{entryLabel(proposal)}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                      <Chip
                        size="small"
                        label={t(`library.moderation.contributions.kind.${proposal.kind ?? 'edit'}`)}
                      />
                      <Box
                        component="span"
                        sx={{ display: { xs: 'none', sm: 'contents' } }}
                      >
                        <OriginChips proposal={proposal} t={t} />
                      </Box>
                    </Stack>
                  </TableCell>
                  {/* Both repeat inside the review dialog, so dropping them
                      here costs a phone user nothing and keeps the action
                      on-screen. */}
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    {proposal.proposed_by_label || t('library.anonymousAuthor')}
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    {formatDate(proposal.created_at)}
                  </TableCell>
                  <TableCell align="right">
                    <DisabledActionTooltip title={busyAction !== null ? t('common:disabledReasons.busy') : ''}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<RateReviewOutlinedIcon />}
                        disabled={busyAction !== null}
                        onClick={() => openReview(proposal)}
                      >
                        {t('library.moderation.contributions.review')}
                      </Button>
                    </DisabledActionTooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={reviewing !== null} onClose={closeReview} fullWidth maxWidth="sm">
        <DialogTitle>{t('library.moderation.contributions.dialogTitle')}</DialogTitle>
        <DialogContent>
          {reviewing ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2">
                {isNewPublish
                  ? t('library.moderation.contributions.dialogIntroNewPublish', { name: entryLabel(reviewing) })
                  : t('library.moderation.contributions.dialogIntroEdit', { name: entryLabel(reviewing) })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('library.moderation.contributions.proposedBy', {
                  name: reviewing.proposed_by_label || t('library.anonymousAuthor'),
                  date: formatDate(reviewing.created_at),
                })}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                <Chip
                  size="small"
                  label={t(`library.moderation.contributions.kind.${reviewing.kind ?? 'edit'}`)}
                />
                <OriginChips proposal={reviewing} t={t} />
              </Stack>
              {reviewing.origin_declared_agent ? (
                <Alert severity="info">
                  {t('library.moderation.contributions.origin.agentTooltip')}
                </Alert>
              ) : null}
              {proposedFields.length === 0 ? (
                isNewPublish ? null : (
                  <Typography color="text.secondary">
                    {t('library.moderation.contributions.noFieldChanges')}
                  </Typography>
                )
              ) : (
                <TableContainer>
                  <Table size="small" aria-label={t('library.moderation.contributions.dialogTitle')}>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('library.moderation.contributions.columns.field')}</TableCell>
                        <TableCell>{t('library.moderation.contributions.columns.value')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {proposedFields.map(([field, value]) => (
                        <TableRow key={field}>
                          <TableCell>{getCropFieldLabel(field, t)}</TableCell>
                          <TableCell sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {formatHistoryChangeValue(value, field, t)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
              <TextField
                label={t('library.moderation.contributions.reviewNote')}
                helperText={t('library.moderation.contributions.reviewNoteHint')}
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                size="small"
                multiline
                minRows={2}
                fullWidth
              />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1, '& > :not(style) ~ :not(style)': { ml: 0 } }}>
          <Button onClick={closeReview} disabled={busyAction !== null}>
            {t('library.moderation.cancel')}
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<CloseOutlinedIcon />}
            disabled={busyAction !== null}
            onClick={() => void review('reject')}
          >
            {t('library.moderation.reject')}
          </Button>
          <Button
            variant="contained"
            startIcon={<CheckOutlinedIcon />}
            disabled={busyAction !== null}
            onClick={() => void review('approve')}
          >
            {busyAction !== null
              ? t('library.moderation.saving')
              : t('library.moderation.approve')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
