import { Card, CardContent, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import {
  settingsReadableDisabledButtonsSx,
  settingsSectionScrollMarginSx,
} from './settingsStyles';

interface SettingsSectionProps {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** Footer actions, right-aligned (e.g. Cancel + Save). */
  actions?: ReactNode;
  tone?: 'danger';
  children?: ReactNode;
}

/**
 * One titled card on a settings page. Every section has an `h2` heading and an
 * `id` that the `SettingsLayout` navigation links to.
 */
export function SettingsSection({ id, title, description, actions, tone, children }: SettingsSectionProps) {
  const headingId = `${id}-title`;
  const isDanger = tone === 'danger';

  return (
    <Card
      component="section"
      id={id}
      variant="outlined"
      aria-labelledby={headingId}
      sx={{
        ...settingsSectionScrollMarginSx,
        ...settingsReadableDisabledButtonsSx,
        ...(isDanger ? { borderColor: 'error.main' } : {}),
      }}
    >
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        <Typography
          id={headingId}
          component="h2"
          variant="h6"
          sx={{ mb: description ? 0.5 : 2, color: isDanger ? 'error.main' : undefined }}
        >
          {title}
        </Typography>
        {description ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {description}
          </Typography>
        ) : null}
        {children}
        {actions ? (
          <Stack
            direction={{ xs: 'column-reverse', sm: 'row' }}
            spacing={1}
            sx={{ justifyContent: 'flex-end', mt: 3 }}
          >
            {actions}
          </Stack>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface SettingsSubsectionProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

/** An `h3` group inside a `SettingsSection`. */
export function SettingsSubsection({ title, description, children }: SettingsSubsectionProps) {
  return (
    <Stack component="section" spacing={1.5}>
      <div>
        <Typography component="h3" variant="subtitle1">
          {title}
        </Typography>
        {description ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        ) : null}
      </div>
      {children}
    </Stack>
  );
}
