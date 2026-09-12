import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Container, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { useAuth } from './useAuth';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';

/**
 * Copy and target page per consent-requiring document. Add an entry here
 * (and the matching `auth:reconsent.<key>.*` i18n strings) when a new
 * document starts requiring versioned consent — no other gating logic
 * needs to change.
 */
const CONSENT_DOCUMENT_CONFIG: Record<string, { path: string; translationKey: string; versionKey: string }> = {
  terms: { path: '/nutzungsbedingungen', translationKey: 'terms', versionKey: 'legal.terms.version' },
  privacy: { path: '/datenschutz', translationKey: 'privacy', versionKey: 'legal.privacy.version' },
};

export default function ConsentGate() {
  const { user, acceptConsent, logout } = useAuth();
  const { t } = useTranslation(['auth', 'home']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const documentKey = user?.pending_consents[0];
  const config = documentKey ? CONSENT_DOCUMENT_CONFIG[documentKey] : undefined;
  const additionalPendingDocuments = user?.pending_consents
    .filter((pendingDocument) => pendingDocument !== documentKey)
    .map((pendingDocument) => CONSENT_DOCUMENT_CONFIG[pendingDocument])
    .filter((pendingConfig): pendingConfig is NonNullable<typeof pendingConfig> => pendingConfig !== undefined) ?? [];

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (!user || !documentKey || !config) {
    return null;
  }

  const handleAccept = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      await acceptConsent(documentKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reconsent.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    setError(null);
    try {
      await logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reconsent.failed'));
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Stack spacing={2.5}>
        <Typography
          variant="h4"
          ref={headingRef}
          tabIndex={-1}
          sx={{ outline: 'none' }}
        >
          {t(`reconsent.${config.translationKey}.title`)}
        </Typography>
        <Typography color="text.secondary">
          {t(`reconsent.${config.translationKey}.body`)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('reconsent.currentVersion', { version: t(`home:${config.versionKey}`) })}
        </Typography>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Stack spacing={0.75}>
          <Link component={RouterLink} to={config.path} target="_blank" rel="noopener">
            {t(`reconsent.${config.translationKey}.linkLabel`)}
          </Link>
          {additionalPendingDocuments.length > 0 ? (
            <Stack spacing={0.5}>
              <Typography variant="body2" color="text.secondary">
                {t('reconsent.additionalDocuments')}
              </Typography>
              {additionalPendingDocuments.map((pendingConfig) => (
                <Link key={pendingConfig.translationKey} component={RouterLink} to={pendingConfig.path} target="_blank" rel="noopener">
                  {t(`reconsent.${pendingConfig.translationKey}.linkLabel`)}
                </Link>
              ))}
            </Stack>
          ) : null}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy') : ''}>
            <Button variant="contained" onClick={() => void handleAccept()} disabled={submitting}>
              {submitting ? t('reconsent.accepting') : t(`reconsent.${config.translationKey}.acceptButton`)}
            </Button>
          </DisabledActionTooltip>
          <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy') : ''}>
            <Button variant="outlined" onClick={() => void handleLogout()} disabled={submitting}>
              {t('reconsent.logout')}
            </Button>
          </DisabledActionTooltip>
        </Stack>
      </Stack>
    </Container>
  );
}
