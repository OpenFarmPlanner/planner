import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Link } from '@mui/material';
import { useMemo } from 'react';
import { Link as RouterLink } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { useTranslation } from '../i18n';
import { readLastProjectRoute } from './lastProjectRoute';

/**
 * "← Back to <project>" link for pages outside the project navigation (the
 * account settings). Leads to the last project page visited in this tab, or
 * the project overview.
 */
export function BackToProjectLink() {
  const { t } = useTranslation('navigation');
  const { user, activeProjectId } = useAuth();
  const target = useMemo(() => readLastProjectRoute(), []);
  const projectName = user?.memberships?.find((membership) => membership.project_id === activeProjectId)?.project_name;

  return (
    <Link
      component={RouterLink}
      to={target}
      underline="hover"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        minHeight: 44,
        fontWeight: 500,
        '&:focus-visible': {
          outline: (theme) => `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
          borderRadius: 0.5,
        },
      }}
    >
      <ArrowBackIcon fontSize="small" aria-hidden="true" />
      {projectName
        ? t('backToProject.named', { project: projectName })
        : t('backToProject.overview')}
    </Link>
  );
}
