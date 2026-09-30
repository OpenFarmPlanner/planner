import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { CropsHistoryDialog } from '../pages/CropsHistoryDialog';
import i18n from '../i18n';
import type { CropHistoryEntry } from '../api/types';
import type { HistoryScope } from '../pages/cropsHistoryUtils';

const t = i18n.getFixedT('de', 'crops');

const entry = (partial: Partial<CropHistoryEntry> = {}): CropHistoryEntry => ({
  history_id: 1,
  history_date: '2026-03-23T14:48:00.000Z',
  history_type: 'snapshot',
  history_user: null,
  summary: '',
  ...partial,
});

interface RenderOptions {
  scope?: HistoryScope;
  items?: CropHistoryEntry[];
  isMobile?: boolean;
  open?: boolean;
  fallbackActorLabel?: string;
}

const renderDialog = ({
  scope = 'crop',
  items = [entry()],
  isMobile = false,
  open = true,
  fallbackActorLabel,
}: RenderOptions = {}) => {
  const onClose = vi.fn();
  const onRestore = vi.fn();
  const view = render(
    <MemoryRouter>
      <CropsHistoryDialog
        open={open}
        scope={scope}
        items={items}
        isMobile={isMobile}
        fallbackActorLabel={fallbackActorLabel}
        onClose={onClose}
        onRestore={onRestore}
        t={t}
      />
    </MemoryRouter>,
  );
  return { ...view, onClose, onRestore };
};

/**
 * The crops page's history dialog. Purely presentational -- loading, state and
 * the restore call live in `Crops.tsx`, and the label helpers have their own
 * tests in `cropsHistoryUtils.test.ts`. What is left, and what is covered
 * here, is which of its several shapes it renders: three scopes that show
 * different things, and a mobile card layout beside a desktop row layout.
 *
 * The real German bundle is used rather than a passthrough `t`, because
 * several of these branches differ only in which sentence they produce.
 */
describe('CropsHistoryDialog', () => {
  describe('scope titles', () => {
    it('names the crop scope as versions of one crop', () => {
      renderDialog({ scope: 'crop' });

      expect(screen.getByRole('heading', { name: 'Versionen' })).toBeInTheDocument();
    });

    it('names the project scope as snapshots', () => {
      renderDialog({ scope: 'project' });

      expect(screen.getByRole('heading', { name: 'Projekt-Snapshots' })).toBeInTheDocument();
    });

    it('names the global scope as the whole history', () => {
      // Three different answers to "what am I looking at", and the only thing
      // in the dialog that distinguishes a project snapshot list from the
      // global one at a glance.
      renderDialog({ scope: 'global' });

      expect(screen.getByRole('heading', { name: 'Globaler Verlauf' })).toBeInTheDocument();
    });
  });

  describe('when there is no history', () => {
    it('explains the absence rather than showing an empty list', () => {
      renderDialog({ items: [] });

      expect(screen.getByText('Kein Versionsverlauf verfügbar.')).toBeInTheDocument();
      expect(
        screen.getByText('Für diese Sorte existiert aktuell noch kein Versionsverlauf.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('offers nothing to restore', () => {
      renderDialog({ items: [] });

      expect(
        screen.queryByRole('button', { name: 'Zu dieser Version wechseln' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('when only the current version exists', () => {
    it('says so, so the absence of a restore button is explained', () => {
      renderDialog({ items: [entry({ is_current_version: true })] });

      // Otherwise a one-entry list looks like a history dialog that has
      // simply failed to offer its one action.
      expect(screen.getByText('Noch keine ältere Version verfügbar.')).toBeInTheDocument();
    });

    it('drops the hint once there is something older', () => {
      renderDialog({
        items: [
          entry({ history_id: 2, is_current_version: true }),
          entry({ history_id: 1 }),
        ],
      });

      expect(screen.queryByText('Noch keine ältere Version verfügbar.')).not.toBeInTheDocument();
    });
  });

  describe('current version versus restorable ones', () => {
    it('badges the current version instead of offering to restore it', () => {
      renderDialog({
        items: [
          entry({ history_id: 2, is_current_version: true }),
          entry({ history_id: 1 }),
        ],
      });

      expect(screen.getByText('Aktuelle Version')).toBeInTheDocument();
      // One badge, one button: restoring the version you are already on is a
      // no-op that looks like an action.
      expect(screen.getAllByRole('button', { name: 'Zu dieser Version wechseln' })).toHaveLength(1);
    });

    it('treats the newest entry as current when the server does not say', () => {
      renderDialog({ items: [entry({ history_id: 2 }), entry({ history_id: 1 })] });

      expect(screen.getByText('Aktuelle Version')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Zu dieser Version wechseln' })).toHaveLength(1);
    });

    it('believes the server over the ordering', () => {
      // A list whose first entry is explicitly not current -- the position
      // heuristic only applies when the flag is absent.
      renderDialog({
        items: [
          entry({ history_id: 2, is_current_version: false }),
          entry({ history_id: 1, is_current_version: true }),
        ],
      });

      expect(screen.getAllByRole('button', { name: 'Zu dieser Version wechseln' })).toHaveLength(1);
      const rows = screen.getAllByRole('listitem');
      expect(within(rows[0]).getByRole('button', { name: 'Zu dieser Version wechseln' }))
        .toBeInTheDocument();
      expect(within(rows[1]).getByText('Aktuelle Version')).toBeInTheDocument();
    });

    it('restores the entry whose button was pressed', async () => {
      const user = userEvent.setup();
      const { onRestore } = renderDialog({
        items: [
          entry({ history_id: 30, is_current_version: true }),
          entry({ history_id: 20 }),
          entry({ history_id: 10 }),
        ],
      });

      const buttons = screen.getAllByRole('button', { name: 'Zu dieser Version wechseln' });
      await user.click(buttons[1]);

      // Restoring the wrong revision silently discards work, so the id has to
      // come from the row and not from the list.
      expect(onRestore).toHaveBeenCalledWith(10);
    });
  });

  describe('changed fields, in crop scope', () => {
    const withChanges = entry({
      history_id: 1,
      changes: [{ field: 'name', old_value: 'Bijella', new_value: 'Bijella F1' }],
    });

    it('shows what changed, from what to what', () => {
      renderDialog({ scope: 'crop', items: [withChanges] });

      expect(screen.getByText('Geändert:')).toBeInTheDocument();
      expect(screen.getByText(/Bijella → Bijella F1/)).toBeInTheDocument();
    });

    it("names the field in the user's own words", () => {
      renderDialog({ scope: 'crop', items: [withChanges] });

      // The raw column name is meaningless to the person reading it.
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.queryByText(/old_value|new_value/)).not.toBeInTheDocument();
    });

    it('keeps the direction of a change', () => {
      renderDialog({
        scope: 'crop',
        items: [entry({ changes: [{ field: 'variety', old_value: 'alt', new_value: 'neu' }] })],
      });

      // Reversed, the entry would claim the opposite edit was made.
      expect(screen.getByText(/alt → neu/)).toBeInTheDocument();
      expect(screen.queryByText(/neu → alt/)).not.toBeInTheDocument();
    });

    it('states a creation as one value rather than an arrow from nothing', () => {
      renderDialog({
        scope: 'crop',
        items: [entry({ changes: [{ field: 'created', old_value: null, new_value: true }] })],
      });

      // There is no "before" for a creation; an arrow would invent one.
      expect(screen.queryByText(/→/)).not.toBeInTheDocument();
    });

    it('renders nothing extra for an entry with no recorded changes', () => {
      renderDialog({ scope: 'crop', items: [entry({ changes: [] })] });

      expect(screen.queryByText('Geändert:')).not.toBeInTheDocument();
    });

    it('survives an entry with no changes field at all', () => {
      renderDialog({ scope: 'crop', items: [entry()] });

      expect(screen.queryByText('Geändert:')).not.toBeInTheDocument();
    });

    it('leaves the change list out of the project and global scopes', () => {
      // Those lists span object types, where a field-level diff of one crop
      // is noise rather than context.
      renderDialog({ scope: 'global', items: [withChanges] });

      expect(screen.queryByText('Geändert:')).not.toBeInTheDocument();
    });
  });

  describe('object type, outside crop scope', () => {
    it('says which kind of thing each entry belongs to', () => {
      renderDialog({
        scope: 'global',
        items: [
          entry({ history_id: 2, object_type: 'crop', object_display_name: 'Bijella' }),
          entry({ history_id: 1, object_type: 'planting_plan' }),
        ],
      });

      const rows = screen.getAllByRole('listitem');
      // The type is the link's own label on desktop, so each row says what it
      // belongs to and goes there in one control.
      expect(within(rows[0]).getByRole('link')).toHaveAccessibleName('Kultur');
      expect(within(rows[1]).getByRole('link')).toHaveAccessibleName('Anbauplan');
    });

    it('does not repeat the object type in crop scope, where it is already known', () => {
      renderDialog({
        scope: 'crop',
        items: [entry({ object_type: 'crop', object_display_name: 'Bijella' })],
      });

      expect(screen.queryByText('Bijella')).not.toBeInTheDocument();
    });

    it('links to the crop an entry belongs to', () => {
      renderDialog({
        scope: 'global',
        items: [entry({ object_type: 'crop', crop_id: 42, object_display_name: 'Bijella' })],
      });

      expect(screen.getByRole('link', { name: 'Kultur' })).toHaveAttribute(
        'href',
        '/app/crops?cropId=42',
      );
    });

    it('links to the planting plans for a plan entry', () => {
      renderDialog({ scope: 'global', items: [entry({ object_type: 'planting_plan' })] });

      expect(screen.getByRole('link', { name: 'Anbauplan' })).toHaveAttribute(
        'href',
        '/app/planting-plans',
      );
    });

    it('offers no link for an entry with nowhere to go', () => {
      renderDialog({ scope: 'global', items: [entry({ object_type: 'season' })] });

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('closes itself when a link is followed', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog({
        scope: 'global',
        items: [entry({ object_type: 'planting_plan' })],
      });

      await user.click(screen.getByRole('link', { name: 'Anbauplan' }));

      // The link navigates the page underneath; leaving the dialog open would
      // cover the thing it just navigated to.
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('mobile layout', () => {
    it('puts each entry on its own card', () => {
      renderDialog({
        isMobile: true,
        scope: 'global',
        items: [entry({ object_type: 'crop', object_display_name: 'Bijella', crop_id: 42 })],
      });

      // The desktop layout is a two-column row that does not survive a phone
      // width; the mobile one stacks the same content into a card.
      expect(screen.getByText('Öffnen')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Kultur' })).not.toBeInTheDocument();
    });

    it('labels its link by what it does, since there is no room for the type', () => {
      renderDialog({
        isMobile: true,
        scope: 'global',
        items: [entry({ object_type: 'crop', crop_id: 42 })],
      });

      expect(screen.getByRole('link', { name: 'Öffnen' })).toHaveAttribute(
        'href',
        '/app/crops?cropId=42',
      );
    });

    it('closes when its link is followed', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog({
        isMobile: true,
        scope: 'global',
        items: [entry({ object_type: 'planting_plan' })],
      });

      await user.click(screen.getByRole('link', { name: 'Öffnen' }));

      expect(onClose).toHaveBeenCalled();
    });

    it('still distinguishes the current version from restorable ones', () => {
      renderDialog({
        isMobile: true,
        items: [entry({ history_id: 2, is_current_version: true }), entry({ history_id: 1 })],
      });

      expect(screen.getByText('Aktuelle Version')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Zu dieser Version wechseln' })).toHaveLength(1);
    });

    it('restores the entry whose card button was pressed', async () => {
      const user = userEvent.setup();
      const { onRestore } = renderDialog({
        isMobile: true,
        items: [entry({ history_id: 30, is_current_version: true }), entry({ history_id: 20 })],
      });

      await user.click(screen.getByRole('button', { name: 'Zu dieser Version wechseln' }));

      expect(onRestore).toHaveBeenCalledWith(20);
    });

    it('still shows the changed fields in crop scope', () => {
      renderDialog({
        isMobile: true,
        scope: 'crop',
        items: [entry({ changes: [{ field: 'notes', old_value: 'a', new_value: 'b' }] })],
      });

      expect(screen.getByText('Geändert:')).toBeInTheDocument();
      expect(screen.getByText(/a → b/)).toBeInTheDocument();
    });
  });

  describe('closing', () => {
    it('stays shut until it is opened', () => {
      renderDialog({ open: false });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes from its own button', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog();

      await user.click(screen.getByRole('button', { name: 'Schließen' }));

      expect(onClose).toHaveBeenCalled();
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog();

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalled();
    });
  });
});
