import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { MobileProjectSwitcherDialog } from '../navigation/MobileProjectSwitcherDialog';
import type { ProjectMembershipInfo } from '../auth/types';
import theme from '../theme';

const memberships: ProjectMembershipInfo[] = [
  { project_id: 1, project_name: 'Gärtnerei Nord', role: 'admin' },
  { project_id: 2, project_name: 'Hofgut Süd', role: 'member' },
];

interface RenderOptions {
  open?: boolean;
  projects?: ProjectMembershipInfo[];
  activeProjectId?: number | null;
  activeProjectLabel?: string;
  isSwitchingProject?: boolean;
}

const renderDialog = ({
  open = true,
  projects = memberships,
  activeProjectId = 1,
  activeProjectLabel = 'Gärtnerei Nord',
  isSwitchingProject = false,
}: RenderOptions = {}) => {
  const onClose = vi.fn();
  const onSwitchProject = vi.fn();
  const onOpenCreateProject = vi.fn();
  const view = render(
    <ThemeProvider theme={theme}>
      <MobileProjectSwitcherDialog
        open={open}
        onClose={onClose}
        activeProjectLabel={activeProjectLabel}
        memberships={projects}
        activeProjectId={activeProjectId}
        isSwitchingProject={isSwitchingProject}
        onSwitchProject={onSwitchProject}
        onOpenCreateProject={onOpenCreateProject}
      />
    </ThemeProvider>,
  );
  return { ...view, onClose, onSwitchProject, onOpenCreateProject };
};

const projectList = (): HTMLElement => screen.getByRole('list');
const projectRow = (name: string): HTMLElement =>
  within(projectList()).getByRole('button', { name });

/**
 * The phone version of the project switcher. Its desktop counterpart is
 * `ProjectMenu`, covered separately, and the two are deliberately not the same
 * screen: this one names the active project in its own block at the top and
 * offers only the list plus "create", where the menu also carries settings, a
 * demo import and the trash. Those differences are asserted here rather than
 * left implied, so aligning this dialog to the desktop menu for consistency's
 * sake would fail rather than pass quietly.
 *
 * `RootLayout.tsx` owns all the state; what is left is which rows appear, which
 * one is marked current, and what a tap on each one does.
 */
describe('MobileProjectSwitcherDialog', () => {
  describe('what it shows', () => {
    it('titles itself and labels both sections', () => {
      renderDialog();
      expect(screen.getByText('Aktives Projekt wechseln')).toBeInTheDocument();
      expect(screen.getByText('Aktives Projekt')).toBeInTheDocument();
      expect(screen.getByText('Projekte')).toBeInTheDocument();
    });

    /**
     * The caller's label, not the membership name: `RootLayout` may decorate it
     * (a demo marker, a region) and the dialog has to show what the topbar
     * shows.
     */
    it('shows the active project label it was handed', () => {
      renderDialog({ activeProjectLabel: 'Gärtnerei Nord (Demo)' });
      expect(screen.getByText('Gärtnerei Nord (Demo)')).toBeInTheDocument();
    });

    it('renders nothing while closed', () => {
      renderDialog({ open: false });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes on Escape without switching', async () => {
      const user = userEvent.setup();
      const { onClose, onSwitchProject } = renderDialog();
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSwitchProject).not.toHaveBeenCalled();
    });
  });

  describe('the project list', () => {
    it('lists every project the account belongs to', () => {
      renderDialog();
      expect(projectRow('Gärtnerei Nord')).toBeInTheDocument();
      expect(projectRow('Hofgut Süd')).toBeInTheDocument();
    });

    it('keeps the order the caller supplied', () => {
      renderDialog();
      expect(
        within(projectList())
          .getAllByRole('button')
          .map((row) => row.textContent),
      ).toEqual(['Gärtnerei Nord', 'Hofgut Süd']);
    });

    it('marks the active project', () => {
      renderDialog({ activeProjectId: 2 });
      expect(projectRow('Hofgut Süd')).toHaveClass('Mui-selected');
      expect(projectRow('Gärtnerei Nord')).not.toHaveClass('Mui-selected');
    });

    it('ticks the active project and only that one', () => {
      renderDialog({ activeProjectId: 2 });
      expect(
        projectRow('Hofgut Süd').querySelector('[data-testid="CheckIcon"]'),
      ).toBeInTheDocument();
      expect(projectRow('Gärtnerei Nord').querySelector('[data-testid="CheckIcon"]')).toBeNull();
    });

    /**
     * The icon slot stays in place on every row even when empty, so the names
     * line up down the list instead of the unticked ones shifting left.
     */
    it('keeps the tick column on unticked rows too', () => {
      renderDialog({ activeProjectId: 1 });
      expect(
        projectRow('Hofgut Süd').querySelector('.MuiListItemIcon-root'),
      ).toBeInTheDocument();
    });

    it('switches to the project that was tapped', async () => {
      const user = userEvent.setup();
      const { onSwitchProject } = renderDialog();
      await user.click(projectRow('Hofgut Süd'));
      expect(onSwitchProject).toHaveBeenCalledExactlyOnceWith(2);
    });

    it('does not close itself -- the caller closes after switching', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog();
      await user.click(projectRow('Hofgut Süd'));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('ticks nothing while no project is active', () => {
      renderDialog({ activeProjectId: null });
      expect(projectList().querySelectorAll('[data-testid="CheckIcon"]')).toHaveLength(0);
      within(projectList())
        .getAllByRole('button')
        .forEach((rowEl) => expect(rowEl).not.toHaveClass('Mui-selected'));
    });
  });

  describe('with no project access', () => {
    it('says so instead of showing an empty list', () => {
      renderDialog({ projects: [] });
      expect(
        within(projectList()).getByText('Du hast aktuell keinen Projektzugriff.'),
      ).toBeInTheDocument();
    });

    /** The notice is not a row to tap -- there is nothing to switch to. */
    it('leaves the notice untappable', () => {
      renderDialog({ projects: [] });
      expect(within(projectList()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('still offers the way out of that state', () => {
      renderDialog({ projects: [] });
      expect(screen.getByRole('button', { name: 'Neues Projekt' })).toBeInTheDocument();
    });

    it('shows no notice once there is a project', () => {
      renderDialog();
      expect(
        screen.queryByText('Du hast aktuell keinen Projektzugriff.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('while a switch is in flight', () => {
    /**
     * `aria-disabled`, not the `disabled` attribute: `ListItemButton` renders a
     * `div` with `role="button"`, which cannot carry `disabled` at all.
     */
    it('disables every project row', () => {
      renderDialog({ isSwitchingProject: true });
      expect(projectRow('Gärtnerei Nord')).toHaveAttribute('aria-disabled', 'true');
      expect(projectRow('Hofgut Süd')).toHaveAttribute('aria-disabled', 'true');
    });

    /** Creating a project navigates away, so a pending switch must not block it. */
    it('leaves creating a project available', () => {
      renderDialog({ isSwitchingProject: true });
      expect(screen.getByRole('button', { name: 'Neues Projekt' })).toBeEnabled();
    });

    it('enables the rows again once it finishes', () => {
      renderDialog({ isSwitchingProject: false });
      expect(projectRow('Gärtnerei Nord')).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('creating a project', () => {
    it('hands off to the caller', async () => {
      const user = userEvent.setup();
      const { onOpenCreateProject, onSwitchProject } = renderDialog();
      await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
      expect(onOpenCreateProject).toHaveBeenCalledTimes(1);
      expect(onSwitchProject).not.toHaveBeenCalled();
    });

    it('sits outside the list, below it', () => {
      renderDialog();
      const create = screen.getByRole('button', { name: 'Neues Projekt' });
      expect(projectList().contains(create)).toBe(false);
      expect(
        projectList().compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe('deliberately unlike the desktop menu', () => {
    /**
     * `ProjectMenu` carries these; this dialog does not, and that is the
     * product decision rather than an oversight. Asserting their absence is
     * what keeps a later "make mobile match desktop" change from happening
     * silently.
     */
    it.each(['Projekteinstellungen', 'Projekt wechseln', 'Demo-Projekt laden'])(
      'offers no %s',
      (name) => {
        renderDialog();
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      },
    );

    it('offers no trash row', () => {
      renderDialog();
      expect(screen.queryByText(/Papierkorb/)).not.toBeInTheDocument();
    });

    /** The menu has no such block -- the topbar button already names it there. */
    it('names the active project in a block of its own', () => {
      renderDialog({ activeProjectId: 1, activeProjectLabel: 'Gärtnerei Nord' });
      const heading = screen.getByText('Aktives Projekt');
      const block = heading.nextElementSibling as HTMLElement;
      expect(within(block).getByText('Gärtnerei Nord')).toBeInTheDocument();
      expect(projectList().contains(block)).toBe(false);
    });
  });
});
