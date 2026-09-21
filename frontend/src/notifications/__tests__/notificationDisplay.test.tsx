import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { NotificationItemContent } from '../NotificationItemContent';
import { getNotificationLink } from '../notificationDisplay';
import type { AppNotification } from '../../api/types';

const REASSIGNMENT: AppNotification = {
  id: 1,
  notification_type: 'crop_species_reassigned',
  message: 'The crop species of "Mangold Lucullus" changed.',
  context: {
    crop_name: 'Mangold Lucullus',
    old_name: 'Gurke',
    new_name: 'Mangold',
    changed_fields: [
      { field: 'rotation_break_years', old_value: 3, new_value: 4 },
      { field: 'nutrient_demand', old_value: 'high', new_value: 'medium' },
    ],
  },
  target_type: 'crop',
  target_id: 42,
  is_read: false,
  created_at: new Date().toISOString(),
} as unknown as AppNotification;

describe('crop species reassignment notification', () => {
  it('names the changed values inline, using the crop library diff labels', () => {
    render(<NotificationItemContent notification={REASSIGNMENT} />);

    // Labels and values come from `library.publishWizard.comparison.*`, the
    // same source the public-update diff table renders with.
    expect(screen.getByText(/Anbaupause \(Jahre\): 3 → 4/)).toBeInTheDocument();
    expect(screen.getByText(/Nährstoffbedarf: /)).toBeInTheDocument();
    expect(screen.getByText(/Gurke/)).toBeInTheDocument();
    expect(screen.getByText(/Mangold/)).toBeInTheDocument();
  });

  it('links to the affected crop in the project crop list', () => {
    expect(getNotificationLink(REASSIGNMENT)).toBe('/app/crops?cropId=42');
  });

  it('leaves notifications without a field diff untouched', () => {
    const plain = {
      ...REASSIGNMENT,
      id: 2,
      notification_type: 'public_crop_removed',
      context: { name: 'Bohne', species_name: 'Feuerbohne' },
    } as unknown as AppNotification;

    render(<NotificationItemContent notification={plain} />);

    expect(screen.getByText(/„Bohne“ wurde aus der Kulturbibliothek entfernt/)).toBeInTheDocument();
  });
});
