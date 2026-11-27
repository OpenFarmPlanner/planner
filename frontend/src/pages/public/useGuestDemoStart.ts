import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router';

import { AuthApiError, getGuestDemoRetryAfterSeconds } from '../../auth/authApi';
import { useAuth } from '../../auth/useAuth';
import { useTranslation } from '../../i18n';

function formatRetryTime(seconds: number, t: TFunction<'home'>): string {
  if (seconds < 60) {
    return t('landing.retryTime.lessThanMinute');
  }

  const totalMinutes = Math.ceil(seconds / 60);
  if (totalMinutes < 60) {
    return t('landing.retryTime.minutes', { count: totalMinutes });
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return t('landing.retryTime.hours', { count: hours });
  }
  return t('landing.retryTime.hoursAndMinutes', { hours, minutes });
}

function formatCompactRetryTime(seconds: number, t: TFunction<'home'>): string {
  if (seconds < 60) {
    return t('landing.retryTime.compact.lessThanMinute');
  }

  const totalMinutes = Math.ceil(seconds / 60);
  if (totalMinutes < 60) {
    return t('landing.retryTime.compact.minutes', { count: totalMinutes });
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return t('landing.retryTime.compact.hours', { count: hours });
  }
  return t('landing.retryTime.compact.hoursAndMinutes', { hours, minutes });
}

export interface GuestDemoStartState {
  isStartingDemo: boolean;
  demoStartError: string | null;
  retryRemainingSeconds: number;
  isDemoRetryBlocked: boolean;
  isDemoButtonDisabled: boolean;
  compactRetryTime: string | null;
  startDemo: () => Promise<void>;
}

export function useGuestDemoStart(): GuestDemoStartState {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const { startGuestDemo } = useAuth();
  const [isStartingDemo, setIsStartingDemo] = useState(false);
  const [demoStartError, setDemoStartError] = useState<string | null>(null);
  const [retryAvailableAt, setRetryAvailableAt] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const retryRemainingSeconds = retryAvailableAt === null
    ? 0
    : Math.max(0, Math.ceil((retryAvailableAt - currentTime) / 1000));
  const isDemoRetryBlocked = retryRemainingSeconds > 0;
  const isDemoButtonDisabled = isStartingDemo || isDemoRetryBlocked;
  const compactRetryTime = isDemoRetryBlocked ? formatCompactRetryTime(retryRemainingSeconds, t) : null;

  useEffect(() => {
    if (retryAvailableAt === null) {
      return undefined;
    }

    if (retryAvailableAt <= Date.now()) {
      setRetryAvailableAt(null);
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      const nextTime = Date.now();
      setCurrentTime(nextTime);
      if (retryAvailableAt <= nextTime) {
        setRetryAvailableAt(null);
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [retryAvailableAt]);

  const startDemo = async (): Promise<void> => {
    if (isDemoButtonDisabled) {
      return;
    }

    setIsStartingDemo(true);
    setDemoStartError(null);
    try {
      await startGuestDemo();
      navigate('/app/fields-beds');
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 429) {
        const retrySeconds = getGuestDemoRetryAfterSeconds(error);
        if (retrySeconds !== undefined) {
          const retryUntil = Date.now() + retrySeconds * 1000;
          setCurrentTime(Date.now());
          setRetryAvailableAt(retryUntil);
          setDemoStartError(t('landing.actions.demoRateLimitedWithTime', {
            time: formatRetryTime(retrySeconds, t),
          }));
        } else {
          setDemoStartError(t('landing.actions.demoRateLimited'));
        }
      } else if (error instanceof AuthApiError && error.isNetworkError) {
        setDemoStartError(t('landing.actions.demoNetworkError'));
      } else if (error instanceof AuthApiError && error.status !== undefined && error.status >= 500) {
        setDemoStartError(t('landing.actions.demoServerError'));
      } else if (error instanceof AuthApiError && error.code === 'unexpected_response') {
        setDemoStartError(t('landing.actions.demoUnexpectedResponse'));
      } else {
        console.error('Error starting guest demo:', error);
        setDemoStartError(t('landing.actions.demoStartError'));
      }
    } finally {
      setIsStartingDemo(false);
    }
  };

  return {
    isStartingDemo,
    demoStartError,
    retryRemainingSeconds,
    isDemoRetryBlocked,
    isDemoButtonDisabled,
    compactRetryTime,
    startDemo,
  };
}
