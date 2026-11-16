import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';
import { createAuthStateMock, createTestUser, stubCompactTopbarViewport } from '../test-utils/appHarness';
import i18n from '../i18n/config';

// Regression tests for the fields-beds topbar "add" button:
// 1) it used to render twice in multi-location mode (registered through
//    both the generic topbar context actions and the create-actions
//    "primary action" system);
// 2) it used to be a split button (main action + dropdown offering the
//    other hierarchy level), which silently stopped working once the
//    create-actions system started shadowing the dropdown-carrying action.
// Kept to one <App/> mount per location-mode to keep this file's runtime
// down — each mount pulls in the full router/command/auth stack.

const { locationListMock, fieldListMock, bedListMock } = vi.hoisted(() => ({
  locationListMock: vi.fn(),
  fieldListMock: vi.fn(),
  bedListMock: vi.fn(),
}));

const authState = createAuthStateMock();

vi.mock('../auth/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    locationAPI: {
      ...actual.locationAPI,
      list: locationListMock,
      listAll: async () => (await locationListMock()).data,
    },
    fieldAPI: {
      ...actual.fieldAPI,
      list: fieldListMock,
      listAll: async () => (await fieldListMock()).data,
    },
    bedAPI: {
      ...actual.bedAPI,
      list: bedListMock,
      listAll: async () => (await bedListMock()).data,
    },
  };
});

describe('RootLayout fields-beds topbar "add location" action', () => {
  beforeEach(async () => {
    authState.user = createTestUser();
    authState.activeProjectId = 1;
    locationListMock.mockReset();
    fieldListMock.mockReset();
    bedListMock.mockReset();
    locationListMock.mockResolvedValue({
      data: { results: [{ id: 1, name: 'Acker am Bach' }, { id: 2, name: 'Hofgarten' }] },
    });
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    bedListMock.mockResolvedValue({ data: { results: [] } });
    await i18n.changeLanguage('de');
    window.localStorage.clear();
    window.history.pushState({}, '', '/app/fields-beds');
  });

  it('renders a single split "Standort hinzufügen" button offering "Parzelle hinzufügen" when multiple locations exist', async () => {
    const user = userEvent.setup();
    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    await screen.findByText('Hofgarten', {}, { timeout: 10000 });

    expect(screen.getAllByRole('button', { name: /Standort hinzufügen/ })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Weitere Optionen' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Parzelle hinzufügen' }));

    // The menu item's onClick (requestInlineFieldCreation) ran without
    // throwing and closed the menu; the resulting inline DataGrid draft row
    // is exercised separately by FieldsBedsHierarchy's own tests.
    await vi.waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('offers "Standort hinzufügen" from the split-button dropdown in single-location mode and opens the add-location dialog', async () => {
    const user = userEvent.setup();
    locationListMock.mockResolvedValue({
      data: { results: [{ id: 1, name: 'Hofstelle' }] },
    });
    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    const topbar = within(screen.getByRole('banner'));
    await topbar.findByRole('button', { name: /Parzelle hinzufügen/ }, { timeout: 10000 });
    expect(topbar.getAllByRole('button', { name: /Parzelle hinzufügen/ })).toHaveLength(1);

    await user.click(topbar.getByRole('button', { name: 'Weitere Optionen' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Standort hinzufügen' }));

    expect(await screen.findByText('Weiteren Standort hinzufügen')).toBeInTheDocument();
  });

  it('renders a single "Standort hinzufügen" add button on the compact mobile topbar too', async () => {
    // setupTests' shared afterEach unstubs matchMedia again.
    stubCompactTopbarViewport();
    render(<FocusManagerProvider><CommandProvider><App /></CommandProvider></FocusManagerProvider>);

    await screen.findByText('Hofgarten', {}, { timeout: 10000 });

    // Regression: HIERARCHY_CREATE_LOCATION_ACTION_ID used to flow into
    // both fieldsGlobalAddAction/mobileFieldsAddLocationAction *and* the
    // generic topbarModeControls/topbarOverflowActions pipeline on the
    // compact mobile topbar, rendering the same "add" button twice.
    expect(screen.getAllByLabelText(/Standort hinzufügen/)).toHaveLength(1);
  });
});
