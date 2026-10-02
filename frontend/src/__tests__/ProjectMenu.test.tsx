import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectMenu } from '../navigation/ProjectMenu';
import i18n from '../i18n';

const t = i18n.getFixedT('de', 'navigation') as unknown as (
  key: string,
  options?: Record<string, unknown>,
) => string;

type Membership = { project_id: number; project_name: string; role: 'admin' | 'member' };

const memberships: Membership[] = [
  { project_id: 1, project_name: 'Gärtnerei Nord', role: 'admin' },
  { project_id: 2, project_name: 'Hofgut Süd', role: 'member' },
];

interface RenderOptions {
  open?: boolean;
  projects?: Membership[];
  activeProjectId?: number | null;
  isSwitchingProject?: boolean;
  isCreatingDemoProject?: boolean;
  deletedProjectsCount?: number;
}

const renderMenu = ({
  open = true,
  projects = memberships,
  activeProjectId = 1,
  isSwitchingProject = false,
  isCreatingDemoProject = false,
  deletedProjectsCount = 0,
}: RenderOptions = {}) => {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const handlers = {
    onClose: vi.fn(),
    onSwitchProject: vi.fn(async () => {}),
    onOpenProjectSettings: vi.fn(),
    onOpenProjectSelection: vi.fn(),
    onOpenCreateProject: vi.fn(),
    onCreateDemoProject: vi.fn(),
    onOpenProjectTrash: vi.fn(),
  };
  const view = render(
    <ProjectMenu
      anchorEl={open ? anchor : null}
      open={open}
      memberships={projects}
      activeProjectId={activeProjectId}
      isSwitchingProject={isSwitchingProject}
      isCreatingDemoProject={isCreatingDemoProject}
      deletedProjectsCount={deletedProjectsCount}
      t={t}
      {...handlers}
    />,
  );
  return { ...view, ...handlers };
};

const action = (name: string | RegExp): HTMLElement => screen.getByRole('menuitem', { name });
const items = (): string[] =>
  screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');

/**
 * The topbar's project switcher menu. `RootLayout.tsx` owns the anchor, the
 * membership list and every handler, so what is covered here is the menu's own
 * shape: which rows exist for a given account, which one is marked as current,
 * what each row does, and which rows disappear while a switch or a demo import
 * is already running.
 *
 * Two of its rows are conditional on account state rather than on a flag -- the
 * zero-projects notice and the trash row -- and getting either wrong is a row
 * the user either cannot act on or cannot reach at all.
 */
describe('ProjectMenu', () => {
  describe('the project list', () => {
    it('lists every project the account belongs to', () => {
      renderMenu();
      expect(action('Gärtnerei Nord')).toBeInTheDocument();
      expect(action('Hofgut Süd')).toBeInTheDocument();
    });

    it('keeps the order the caller supplied', () => {
      renderMenu();
      expect(items().slice(0, 2)).toEqual(['Gärtnerei Nord', 'Hofgut Süd']);
    });

    it('marks the active project as selected', () => {
      renderMenu({ activeProjectId: 2 });
      expect(action('Hofgut Süd')).toHaveClass('Mui-selected');
      expect(action('Gärtnerei Nord')).not.toHaveClass('Mui-selected');
    });

    it('ticks the active project and only that one', () => {
      const { container } = renderMenu({ activeProjectId: 2 });
      expect(action('Hofgut Süd').querySelector('[data-testid="CheckIcon"]')).toBeInTheDocument();
      expect(action('Gärtnerei Nord').querySelector('[data-testid="CheckIcon"]')).toBeNull();
      expect(container.ownerDocument.querySelectorAll('[data-testid="CheckIcon"]')).toHaveLength(1);
    });

    /**
     * `Mui-selected` rather than `aria-selected`: MUI's `selected` prop styles
     * the row but a `menuitem` carries no selected state in ARIA, so Testing
     * Library refuses that filter outright.
     */
    it('ticks nothing while no project is active', () => {
      renderMenu({ activeProjectId: null });
      expect(document.querySelectorAll('[data-testid="CheckIcon"]')).toHaveLength(0);
      screen
        .getAllByRole('menuitem')
        .forEach((row) => expect(row).not.toHaveClass('Mui-selected'));
    });

    it('switches to the project that was clicked', async () => {
      const user = userEvent.setup();
      const { onSwitchProject } = renderMenu();
      await user.click(action('Hofgut Süd'));
      expect(onSwitchProject).toHaveBeenCalledExactlyOnceWith(2);
    });

    /**
     * Clicking the project already open would re-run the switch, which reloads
     * every page query -- but nothing stops it, so this pins the current
     * behaviour rather than an absence of it.
     */
    it('still reports a click on the active project', async () => {
      const user = userEvent.setup();
      const { onSwitchProject } = renderMenu({ activeProjectId: 1 });
      await user.click(action('Gärtnerei Nord'));
      expect(onSwitchProject).toHaveBeenCalledExactlyOnceWith(1);
    });
  });

  describe('with no project access', () => {
    it('says so instead of listing nothing', () => {
      renderMenu({ projects: [] });
      expect(action('Du hast aktuell keinen Projektzugriff.')).toBeInTheDocument();
    });

    /** The notice is a row, so it has to be unclickable or it reads as an action. */
    it('leaves the notice unclickable', () => {
      renderMenu({ projects: [] });
      expect(action('Du hast aktuell keinen Projektzugriff.')).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });

    it('still offers the ways out of that state', () => {
      renderMenu({ projects: [] });
      expect(action('Neues Projekt')).toBeInTheDocument();
      expect(action('Demo-Projekt laden')).toBeInTheDocument();
    });

    it('shows no notice once there is a project', () => {
      renderMenu({ projects: memberships });
      expect(
        screen.queryByText('Du hast aktuell keinen Projektzugriff.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('while a switch is in flight', () => {
    it('disables every project row', () => {
      renderMenu({ isSwitchingProject: true });
      expect(action('Gärtnerei Nord')).toHaveAttribute('aria-disabled', 'true');
      expect(action('Hofgut Süd')).toHaveAttribute('aria-disabled', 'true');
    });

    /**
     * Only the project rows. The settings and create actions navigate rather
     * than switch, so blocking them would strand the user in a menu that does
     * nothing while a slow switch finishes.
     */
    it('leaves the other actions available', () => {
      renderMenu({ isSwitchingProject: true });
      ['Projekt wechseln', 'Projekteinstellungen', 'Neues Projekt'].forEach((name) =>
        expect(action(name)).not.toHaveAttribute('aria-disabled', 'true'),
      );
    });

    it('enables the project rows again once it finishes', () => {
      renderMenu({ isSwitchingProject: false });
      expect(action('Gärtnerei Nord')).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('the fixed actions', () => {
    it.each([
      ['Projekt wechseln', 'onOpenProjectSelection' as const],
      ['Projekteinstellungen', 'onOpenProjectSettings' as const],
      ['Neues Projekt', 'onOpenCreateProject' as const],
      ['Demo-Projekt laden', 'onCreateDemoProject' as const],
    ])('runs %s', async (name, handler) => {
      const user = userEvent.setup();
      const menu = renderMenu();
      await user.click(action(name));
      expect(menu[handler]).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['Projekt wechseln', 'onOpenProjectSelection' as const],
      ['Projekteinstellungen', 'onOpenProjectSettings' as const],
      ['Neues Projekt', 'onOpenCreateProject' as const],
    ])('runs only %s and no switch', async (name, handler) => {
      const user = userEvent.setup();
      const menu = renderMenu();
      await user.click(action(name));
      expect(menu.onSwitchProject).not.toHaveBeenCalled();
      (['onOpenProjectSelection', 'onOpenProjectSettings', 'onOpenCreateProject'] as const)
        .filter((other) => other !== handler)
        .forEach((other) => expect(menu[other]).not.toHaveBeenCalled());
    });

    it('gives every fixed action an icon', () => {
      renderMenu();
      ['Projekt wechseln', 'Projekteinstellungen', 'Neues Projekt', 'Demo-Projekt laden'].forEach(
        (name) => expect(action(name).querySelector('svg')).toBeInTheDocument(),
      );
    });

    it('separates the project list from the actions', () => {
      renderMenu();
      expect(screen.getAllByRole('separator')).toHaveLength(2);
    });
  });

  describe('loading the demo project', () => {
    it('disables the action while one is already being created', () => {
      renderMenu({ isCreatingDemoProject: true });
      expect(action('Demo-Projekt laden')).toHaveAttribute('aria-disabled', 'true');
    });

    it('leaves it available otherwise', () => {
      renderMenu({ isCreatingDemoProject: false });
      expect(action('Demo-Projekt laden')).not.toHaveAttribute('aria-disabled', 'true');
    });

    /** Creating a demo project is independent of switching to another one. */
    it('is not blocked by a switch in flight', () => {
      renderMenu({ isSwitchingProject: true, isCreatingDemoProject: false });
      expect(action('Demo-Projekt laden')).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('the trash row', () => {
    it('stays hidden while nothing is deleted', () => {
      renderMenu({ deletedProjectsCount: 0 });
      expect(screen.queryByRole('menuitem', { name: /Papierkorb/ })).not.toBeInTheDocument();
    });

    it('appears with the count once something is', () => {
      renderMenu({ deletedProjectsCount: 3 });
      expect(action('Papierkorb (3)')).toBeInTheDocument();
    });

    it('appears for a single deleted project too', () => {
      renderMenu({ deletedProjectsCount: 1 });
      expect(action('Papierkorb (1)')).toBeInTheDocument();
    });

    it('gets an icon like the other actions', () => {
      renderMenu({ deletedProjectsCount: 2 });
      expect(action('Papierkorb (2)').querySelector('svg')).toBeInTheDocument();
    });

    it('opens the trash', async () => {
      const user = userEvent.setup();
      const { onOpenProjectTrash } = renderMenu({ deletedProjectsCount: 2 });
      await user.click(action('Papierkorb (2)'));
      expect(onOpenProjectTrash).toHaveBeenCalledTimes(1);
    });

    it('sits last, after the demo action', () => {
      renderMenu({ deletedProjectsCount: 2 });
      expect(items().at(-1)).toBe('Papierkorb (2)');
    });
  });

  describe('being open', () => {
    it('renders nothing while closed', () => {
      renderMenu({ open: false });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('closes on Escape without acting', async () => {
      const user = userEvent.setup();
      const { onClose, onSwitchProject } = renderMenu();
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSwitchProject).not.toHaveBeenCalled();
    });
  });
});
