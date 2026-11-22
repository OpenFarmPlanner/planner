import { useId, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { Box, Button, IconButton, Link, Popover, Stack, Typography } from '@mui/material';
import type { IncompleteYieldPlan } from '../api/types';
import { formatCropDisplayName } from '../crops/cropDisplay';
import { useTranslation } from '../i18n';
import { plantingPlanDetailPath } from '../planting-plans/plantingPlanDetailRoutes';

export function YieldForecastWarning({ plans }: { plans: IncompleteYieldPlan[] }) {
  const { t, i18n } = useTranslation(['yieldOverview', 'common']);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();
  const count = plans.length;
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const close = () => setAnchor(null);

  return (
    <>
      <Button
        size="small"
        color="inherit"
        startIcon={<WarningAmberRoundedIcon sx={{
          color: theme => theme.palette.mode === 'dark' ? theme.palette.warning.light : theme.palette.warning.dark,
        }} />}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? id : undefined}
        onClick={event => setAnchor(event.currentTarget)}
        sx={{
          minHeight: 44,
          maxWidth: '100%',
          textAlign: 'start',
          textTransform: 'none',
          overflowWrap: 'anywhere',
        }}
      >
        {t('diagnostics.summary', { count })}
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            id,
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': `${id}-title`,
            sx: { width: 400, p: 2, overflowWrap: 'anywhere' },
          },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography id={`${id}-title`} component="h2" variant="subtitle1">
            {t('diagnostics.title', { count })}
          </Typography>
          <IconButton onClick={close} aria-label={t('common:actions.close')} sx={{ minWidth: 44, minHeight: 44 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack component="ul" spacing={1} sx={{ m: 0, pl: 2.5 }}>
          {plans.map(plan => {
            const date = plan.planting_date
              ? dateFormatter.format(new Date(`${plan.planting_date}T00:00:00Z`))
              : null;
            const planLabel = [
              formatCropDisplayName(plan) || t('diagnostics.unnamedPlan'),
              plan.bed_name,
              date,
            ].filter(Boolean).join(' · ');
            return (
              <Box component="li" key={plan.plan_id}>
                <Link component={RouterLink} to={plantingPlanDetailPath(plan.plan_id)}>
                  {planLabel}
                </Link>
                <Typography variant="body2">
                  {plan.calculation_blockers.map(blocker => t(`diagnostics.blockers.${blocker}`)).join(' · ')}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      </Popover>
    </>
  );
}
