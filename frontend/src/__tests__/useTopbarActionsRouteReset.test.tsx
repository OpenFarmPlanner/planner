import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTopbarWorkspaceControls } from '../hooks/useTopbarWorkspaceControls';
import { useTopbarActionsRouteReset } from '../hooks/useTopbarActionsRouteReset';
import { useTopbarContextActions } from '../hooks/useTopbarContextActions';
import type { TopbarContextAction } from '../navigation/topbarTypes';

/**
 * Regression test for a bug where the crop import toolbar button (and
 * any other page-registered topbar action) vanished after navigating away
 * from a page and back.
 *
 * Root cause: the layout resets topbarContextActions on every route change,
 * while pages register their own actions via useTopbarContextActions on
 * mount. Passive effects fire child-before-parent, so once a page mounts in
 * the same commit as the route change (e.g. a lazy chunk that's already
 * cached), a plain useEffect reset in the parent runs *after* the child's
 * registration effect and wipes it out. Using a layout effect for the reset
 * guarantees it always completes before any passive effect, regardless of
 * mount timing.
 */

function Page({ setTopbarContextActions, setControls }: { setTopbarContextActions: (actions: TopbarContextAction[]) => void; setControls: (controls: ReactNode) => void }) {
  const actions = useMemo<TopbarContextAction[]>(() => [
    { id: 'open-library', label: 'Aus Bibliothek importieren', onClick: () => {} },
  ], []);
  useTopbarContextActions(setTopbarContextActions, actions);
  useTopbarWorkspaceControls(setControls, 'Graphic controls');
  return null;
}

function OtherPage() {
  return null;
}

function Layout({ pathname }: { pathname: string }) {
  const [actions, setActions] = useState<TopbarContextAction[]>([]);
  const [, setTitleActions] = useState<TopbarContextAction[]>([]);
  const [controls, setControls] = useState<ReactNode>(null);
  useTopbarActionsRouteReset(pathname, setActions, setTitleActions, setControls);

  return (
    <>
      <div data-testid="controls">{controls}</div>
      <div data-testid="actions">{actions.map((action) => action.label).join(',')}</div>
      {pathname === '/crops' ? <Page setTopbarContextActions={setActions} setControls={setControls} /> : <OtherPage />}
    </>
  );
}

describe('useTopbarActionsRouteReset', () => {
  it('keeps a page-registered action visible when the page remounts in the same commit as the route change', () => {
    const { rerender } = render(<Layout pathname="/crops" />);
    expect(screen.getByTestId('actions')).toHaveTextContent('Aus Bibliothek importieren');
    expect(screen.getByTestId('controls')).toHaveTextContent('Graphic controls');

    rerender(<Layout pathname="/other" />);
    expect(screen.getByTestId('actions')).toHaveTextContent('');
    expect(screen.getByTestId('controls')).toHaveTextContent('');

    // Same-commit remount: React swaps OtherPage for Page in one render pass,
    // exactly like a route change where the target page's lazy chunk is
    // already cached and mounts synchronously with the route transition.
    rerender(<Layout pathname="/crops" />);
    expect(screen.getByTestId('actions')).toHaveTextContent('Aus Bibliothek importieren');
    expect(screen.getByTestId('controls')).toHaveTextContent('Graphic controls');
  });
});
