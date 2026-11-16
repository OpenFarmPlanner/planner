import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditIcon from '@mui/icons-material/Edit';
import { DetailPageActions } from '../components/layout/DetailPageActions';

describe('DetailPageActions', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
  });

  // The label is dropped by CSS below the `lg` breakpoint, so the media query
  // is what tells the component whether the button is currently icon-only.
  function mockLabelsCollapsed(collapsed: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: collapsed && query.includes('max-width:1199.95px'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  const renderActions = (overrides: Partial<Parameters<typeof DetailPageActions>[0]> = {}) =>
    render(
      <DetailPageActions
        primaryActions={[
          { label: 'Bearbeiten', icon: <EditIcon fontSize="small" />, onClick: vi.fn() },
        ]}
        {...overrides}
      />,
    );

  it('explains an icon-only button with its own label as the tooltip', async () => {
    mockLabelsCollapsed(true);
    const user = userEvent.setup();
    renderActions();

    await user.hover(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bearbeiten');
  });

  it('does not add a tooltip once the label itself is on screen', async () => {
    mockLabelsCollapsed(false);
    const user = userEvent.setup();
    renderActions();

    await user.hover(screen.getByRole('button', { name: 'Bearbeiten' }));
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  const blockedAction = {
    label: 'Anbauplan hinzufügen',
    icon: <EditIcon fontSize="small" />,
    onClick: vi.fn(),
    disabled: true,
    tooltip: 'Lege zuerst ein Beet an.',
  };

  // A disabled button swallows pointer events, which is why the tooltip is
  // anchored on the wrapping span rather than on the button itself.
  const hoverWrapper = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.hover(screen.getByRole('button', { name }).parentElement as HTMLElement);
  };

  it('names an icon-only button alongside its disabled reason', async () => {
    mockLabelsCollapsed(true);
    const user = userEvent.setup();
    renderActions({ primaryActions: [blockedAction] });

    await hoverWrapper(user, 'Anbauplan hinzufügen');
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Anbauplan hinzufügen');
    expect(tooltip).toHaveTextContent('Lege zuerst ein Beet an.');
  });

  it('shows only the disabled reason once the label is on screen', async () => {
    mockLabelsCollapsed(false);
    const user = userEvent.setup();
    renderActions({ primaryActions: [blockedAction] });

    await hoverWrapper(user, 'Anbauplan hinzufügen');
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Lege zuerst ein Beet an.');
  });

  it('keeps the same button element when the labels collapse, so focus survives a resize', () => {
    mockLabelsCollapsed(false);
    const { rerender } = renderActions();
    const button = screen.getByRole('button', { name: 'Bearbeiten' });
    button.focus();

    mockLabelsCollapsed(true);
    rerender(
      <DetailPageActions
        primaryActions={[
          { label: 'Bearbeiten', icon: <EditIcon fontSize="small" />, onClick: vi.fn() },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBe(button);
    expect(button).toHaveFocus();
  });

  it('closes and suppresses tooltips behind an overlay without remounting its trigger', async () => {
    mockLabelsCollapsed(true);
    const user = userEvent.setup();
    const actions = [{ label: 'Bearbeiten', icon: <EditIcon />, onClick: vi.fn() }];
    const { rerender } = renderActions({ primaryActions: actions });
    const button = screen.getByRole('button', { name: 'Bearbeiten' });
    await user.hover(button);
    expect(await screen.findByRole('tooltip')).toBeVisible();
    rerender(<DetailPageActions primaryActions={actions} suppressTooltips />);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBe(button);
    await user.unhover(button);
    rerender(<DetailPageActions primaryActions={actions} />);
    await user.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bearbeiten');
  });

  it('always renders the labels so they can be revealed by CSS alone, without a re-render', () => {
    mockLabelsCollapsed(true);
    renderActions();

    expect(screen.getByTestId('detail-page-action-label')).toHaveTextContent('Bearbeiten');
  });
});
