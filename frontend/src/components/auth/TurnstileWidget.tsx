// Cloudflare Turnstile bot check for the registration form. Renders nothing
// visible while the check passes in the background; the challenge only shows
// up when Cloudflare asks for an interaction.

import { Alert, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useRef, useState } from 'react';
import { loadTurnstileScript, type TurnstileApi } from '../../auth/turnstile';
import { useTranslation } from '../../i18n';

export const TURNSTILE_SCRIPT_RETRY_DELAY_MS = 10_000;
export const TURNSTILE_SCRIPT_MAX_ATTEMPTS = 3;

type WidgetProblem = 'none' | 'challengeFailed' | 'loadFailed';

interface TurnstileWidgetProps {
  siteKey: string;
  /** Receives a fresh token, or null once the current one is gone (expired, failed, reset). */
  onTokenChange: (token: string | null) => void;
  /** Increment to discard the current token and run a fresh check (tokens are single-use). */
  resetSignal: number;
}

export default function TurnstileWidget({ siteKey, onTokenChange, resetSignal }: TurnstileWidgetProps) {
  const { t, i18n } = useTranslation('auth');
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<TurnstileApi | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const onTokenChangeRef = useRef(onTokenChange);
  const [problem, setProblem] = useState<WidgetProblem>('none');
  const [interactive, setInteractive] = useState(false);
  const themeMode = theme.palette.mode;
  const language = i18n.resolvedLanguage ?? 'auto';

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const mount = (attempt: number): void => {
      loadTurnstileScript()
        .then((api) => {
          if (cancelled || !containerRef.current) {
            return;
          }
          setProblem('none');
          apiRef.current = api;
          widgetIdRef.current = api.render(containerRef.current, {
            sitekey: siteKey,
            action: 'register',
            theme: themeMode,
            language,
            size: 'flexible',
            appearance: 'interaction-only',
            callback: (token) => {
              setProblem('none');
              onTokenChangeRef.current(token);
            },
            // Turnstile retries failed checks and refreshes expired or
            // timed-out tokens on its own; we only drop the stale token and
            // tell the user what is going on.
            'error-callback': () => {
              setProblem('challengeFailed');
              onTokenChangeRef.current(null);
            },
            'expired-callback': () => onTokenChangeRef.current(null),
            'timeout-callback': () => onTokenChangeRef.current(null),
            'before-interactive-callback': () => setInteractive(true),
            'after-interactive-callback': () => setInteractive(false),
          });
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          setProblem('loadFailed');
          if (attempt < TURNSTILE_SCRIPT_MAX_ATTEMPTS) {
            retryTimer = setTimeout(() => mount(attempt + 1), TURNSTILE_SCRIPT_RETRY_DELAY_MS);
          }
        });
    };

    mount(1);

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      if (apiRef.current && widgetIdRef.current !== undefined) {
        apiRef.current.remove(widgetIdRef.current);
      }
      widgetIdRef.current = undefined;
      onTokenChangeRef.current(null);
    };
  }, [siteKey, themeMode, language]);

  useEffect(() => {
    if (resetSignal === 0 || !apiRef.current || widgetIdRef.current === undefined) {
      return;
    }
    onTokenChangeRef.current(null);
    apiRef.current.reset(widgetIdRef.current);
  }, [resetSignal]);

  return (
    <>
      {problem !== 'none' ? (
        <Alert severity="warning">
          {problem === 'loadFailed' ? t('auth:register.turnstile.loadFailed') : t('auth:register.turnstile.challengeFailed')}
        </Alert>
      ) : null}
      {/* `display: contents` keeps the invisible widget from adding an empty
          row (and its Stack spacing) to the form until Cloudflare actually
          shows a challenge. */}
      <Box
        ref={containerRef}
        data-testid="turnstile-widget"
        sx={{ display: interactive ? 'block' : 'contents' }}
      />
    </>
  );
}
