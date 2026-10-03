import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VersionCard } from '../crop-library/components/publicCropLibrary/VersionCard';
import type { PublicCropRevision } from '../api/types';
import i18n from '../i18n';
import { tooltipOf } from './helpers/disabledActionTooltip';

const t = i18n.getFixedT('de', ['crops', 'common']) as unknown as (
  key: string,
  options?: Record<string, unknown>,
) => string;

const revision = (partial: Partial<PublicCropRevision> = {}): PublicCropRevision =>
  ({
    id: 1,
    public_crop: 7,
    version: 2,
    action: 'updated',
    snapshot: {},
    changed_fields: [],
    created_by_label: 'Martin',
    created_at: '2026-03-23T14:48:00.000Z',
    ...partial,
  }) as PublicCropRevision;

interface RenderOptions {
  rev?: PublicCropRevision;
  currentVersion?: number;
  revertingVersion?: number | null;
}

const renderCard = ({
  rev = revision(),
  currentVersion = 3,
  revertingVersion = null,
}: RenderOptions = {}) => {
  const onRevert = vi.fn(async () => {});
  const onDiscuss = vi.fn();
  const formatDate = vi.fn((value?: string | null) => `datum(${value ?? ''})`);
  const view = render(
    <VersionCard
      revision={rev}
      currentVersion={currentVersion}
      anonymousLabel="Anonym"
      formatDate={formatDate}
      onRevert={onRevert}
      revertingVersion={revertingVersion}
      t={t}
      onDiscuss={onDiscuss}
    />,
  );
  return { ...view, onRevert, onDiscuss, formatDate };
};

const revertButton = (): HTMLElement =>
  screen.getByRole('button', { name: /Wiederherstellen|Stelle wieder her/ });

const chips = (): string[] =>
  Array.from(document.querySelectorAll('.MuiChip-root')).map((chip) => chip.textContent ?? '');

/**
 * One revision in the public crop library's version list. The label helpers are
 * covered by the formatters' own tests, so what is left here is the card's two
 * forks: whether this revision *is* the current one, which decides its chip and
 * whether it offers any actions at all, and whether a revert is in flight, which
 * decides what the revert button says and whether it can be pressed.
 *
 * The in-flight fork is the subtle one. `revertingVersion` is page-wide: every
 * card's button goes disabled while any revert runs, but only the card being
 * reverted says so. Getting that backwards would either let a user start a
 * second revert or make every card claim to be the one reverting.
 */
describe('VersionCard', () => {
  describe('every version', () => {
    it('names its version number', () => {
      renderCard({ rev: revision({ version: 5 }) });
      expect(screen.getByText('Version 5')).toBeInTheDocument();
    });

    it('credits the author and the date', () => {
      const { formatDate } = renderCard({
        rev: revision({ created_by_label: 'Martin', created_at: '2026-01-02T03:04:05.000Z' }),
      });
      expect(formatDate).toHaveBeenCalledWith('2026-01-02T03:04:05.000Z');
      expect(
        screen.getByText('Martin · datum(2026-01-02T03:04:05.000Z)'),
      ).toBeInTheDocument();
    });

    it.each([
      ['a missing author label', undefined],
      ['an empty author label', ''],
    ])('falls back to the anonymous label for %s', (_label, author) => {
      renderCard({ rev: revision({ created_by_label: author }) });
      expect(screen.getByText(/^Anonym · /)).toBeInTheDocument();
    });
  });

  describe('the action chip', () => {
    it.each([
      ['created', 'Erstellt'],
      ['updated', 'Bearbeitet'],
      ['restored', 'Wiederhergestellt'],
    ])('labels a %s revision as %s', (action, label) => {
      renderCard({
        rev: revision({ action: action as PublicCropRevision['action'], version: 2 }),
        currentVersion: 3,
      });
      expect(chips()).toContain(label);
    });

    it('says "current version" instead, for the version in force', () => {
      renderCard({ rev: revision({ version: 3, action: 'updated' }), currentVersion: 3 });
      expect(chips()).toContain('Aktuelle Version');
      expect(chips()).not.toContain('Bearbeitet');
    });

    it('marks the current version with the success colour', () => {
      renderCard({ rev: revision({ version: 3 }), currentVersion: 3 });
      expect(document.querySelector('.MuiChip-colorSuccess')).toBeInTheDocument();
    });

    it('leaves the chip on an older version plain', () => {
      renderCard({ rev: revision({ version: 2 }), currentVersion: 3 });
      expect(document.querySelector('.MuiChip-colorSuccess')).toBeNull();
    });
  });

  describe('the restored-from chip', () => {
    it('says which version a restore came from', () => {
      renderCard({
        rev: revision({ action: 'restored', restored_from_version: 1 }),
      });
      expect(chips()).toContain('Aus Version 1 wiederhergestellt');
    });

    /** Both halves of the condition matter, so both are tested alone. */
    it('stays away on a restore that names no source version', () => {
      renderCard({ rev: revision({ action: 'restored', restored_from_version: null }) });
      expect(chips().some((chip) => chip.startsWith('Aus Version'))).toBe(false);
    });

    it('stays away when a source version is set on a non-restore', () => {
      renderCard({ rev: revision({ action: 'updated', restored_from_version: 1 }) });
      expect(chips().some((chip) => chip.startsWith('Aus Version'))).toBe(false);
    });

    /** Version 0 would be no source either, and `0` is falsy in the guard. */
    it('stays away for a source version of zero', () => {
      renderCard({ rev: revision({ action: 'restored', restored_from_version: 0 }) });
      expect(chips().some((chip) => chip.startsWith('Aus Version'))).toBe(false);
    });

    it('sits before the action chip', () => {
      renderCard({ rev: revision({ action: 'restored', restored_from_version: 1 }) });
      expect(chips()).toEqual(['Aus Version 1 wiederhergestellt', 'Wiederhergestellt']);
    });
  });

  describe('the field changes', () => {
    it('shows each changed field as an old-to-new pair', () => {
      renderCard({
        rev: revision({
          changed_fields: [{ field: 'variety', old_value: 'Nantaise', new_value: 'Rodelika' }],
        }),
      });
      expect(screen.getByText('Sorte')).toBeInTheDocument();
      expect(screen.getByText('Nantaise → Rodelika')).toBeInTheDocument();
    });

    it('lists several changes', () => {
      renderCard({
        rev: revision({
          changed_fields: [
            { field: 'variety', old_value: 'Nantaise', new_value: 'Rodelika' },
            { field: 'growth_duration_days', old_value: 80, new_value: 95 },
          ],
        }),
      });
      expect(screen.getByText('Nantaise → Rodelika')).toBeInTheDocument();
      expect(screen.getByText('80 → 95')).toBeInTheDocument();
    });

    /** A value that was not set before has to read as absent, not as empty. */
    it('names an unset side rather than leaving a gap', () => {
      renderCard({
        rev: revision({ changed_fields: [{ field: 'notes', old_value: null, new_value: 'Neu' }] }),
      });
      expect(screen.getByText('Keine Angabe → Neu')).toBeInTheDocument();
    });

    it.each([
      ['no changed fields', [] as PublicCropRevision['changed_fields']],
      ['a missing changed-fields list', undefined],
    ])('explains %s instead of showing an empty block', (_label, changed) => {
      renderCard({
        rev: revision({ changed_fields: changed as PublicCropRevision['changed_fields'] }),
      });
      expect(screen.getByText('Startversion ohne Feldänderungen.')).toBeInTheDocument();
    });

    it('drops the explanation once there are changes', () => {
      renderCard({
        rev: revision({ changed_fields: [{ field: 'notes', old_value: 'a', new_value: 'b' }] }),
      });
      expect(
        screen.queryByText('Startversion ohne Feldänderungen.'),
      ).not.toBeInTheDocument();
    });

    /** Notes keep their line breaks, so a multi-line diff stays readable. */
    it('preserves whitespace in a changed value', () => {
      renderCard({
        rev: revision({
          changed_fields: [{ field: 'notes', old_value: 'a', new_value: 'b\nc' }],
        }),
      });
      const diff = screen.getByText(/a → b/);
      expect(window.getComputedStyle(diff).whiteSpace).toBe('pre-wrap');
    });
  });

  describe('the actions on an older version', () => {
    it('offers reverting and discussing', () => {
      renderCard({ rev: revision({ version: 2 }), currentVersion: 3 });
      expect(screen.getByRole('button', { name: 'Wiederherstellen' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Diskutieren' })).toBeInTheDocument();
    });

    it('reverts to this version', async () => {
      const user = userEvent.setup();
      const { onRevert, onDiscuss } = renderCard({ rev: revision({ version: 2 }) });
      await user.click(revertButton());
      expect(onRevert).toHaveBeenCalledExactlyOnceWith(2);
      expect(onDiscuss).not.toHaveBeenCalled();
    });

    it('opens a discussion for this revision', async () => {
      const user = userEvent.setup();
      const rev = revision({ version: 2 });
      const { onDiscuss, onRevert } = renderCard({ rev });
      await user.click(screen.getByRole('button', { name: 'Diskutieren' }));
      expect(onDiscuss).toHaveBeenCalledExactlyOnceWith(rev);
      expect(onRevert).not.toHaveBeenCalled();
    });
  });

  describe('the current version', () => {
    /** There is nothing to revert to, and discussing it happens elsewhere. */
    it('offers no actions at all', () => {
      renderCard({ rev: revision({ version: 3 }), currentVersion: 3 });
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('still shows its own field changes', () => {
      renderCard({
        rev: revision({
          version: 3,
          changed_fields: [{ field: 'notes', old_value: 'a', new_value: 'b' }],
        }),
        currentVersion: 3,
      });
      expect(screen.getByText('a → b')).toBeInTheDocument();
    });
  });

  describe('while a revert is in flight', () => {
    it('says so on the card being reverted', () => {
      renderCard({ rev: revision({ version: 2 }), revertingVersion: 2 });
      expect(screen.getByRole('button', { name: 'Stelle wieder her…' })).toBeInTheDocument();
    });

    /**
     * Page-wide: a revert of version 2 must stop a user starting one on version
     * 1 too, but version 1's button must not claim to be the one reverting.
     */
    it('disables another card\'s button without changing its label', () => {
      renderCard({ rev: revision({ version: 1 }), revertingVersion: 2 });
      const button = screen.getByRole('button', { name: 'Wiederherstellen' });
      expect(button).toBeDisabled();
      expect(screen.queryByText('Stelle wieder her…')).not.toBeInTheDocument();
    });

    it('disables the button on the card being reverted too', () => {
      renderCard({ rev: revision({ version: 2 }), revertingVersion: 2 });
      expect(screen.getByRole('button', { name: 'Stelle wieder her…' })).toBeDisabled();
    });

    it('says why the button is disabled', async () => {
      const user = userEvent.setup();
      renderCard({ rev: revision({ version: 1 }), revertingVersion: 2 });
      expect(await tooltipOf(user, revertButton())).toHaveTextContent(
        'Aktion wird gerade verarbeitet.',
      );
    });

    /** Discussing is reading, not writing, so a pending revert leaves it alone. */
    it('leaves discussing available', async () => {
      const user = userEvent.setup();
      const { onDiscuss } = renderCard({ rev: revision({ version: 2 }), revertingVersion: 2 });
      const discuss = screen.getByRole('button', { name: 'Diskutieren' });
      expect(discuss).toBeEnabled();
      await user.click(discuss);
      expect(onDiscuss).toHaveBeenCalledTimes(1);
    });

    it('enables the button again once nothing is reverting', () => {
      renderCard({ rev: revision({ version: 2 }), revertingVersion: null });
      expect(screen.getByRole('button', { name: 'Wiederherstellen' })).toBeEnabled();
    });

    /**
     * `revertingVersion !== null` rather than a truthiness check: version 0 is
     * not a real version, but if it ever arrived, treating it as "nothing is
     * reverting" would re-enable every button mid-revert.
     */
    it('treats a reverting version of zero as a revert in flight', () => {
      renderCard({ rev: revision({ version: 1 }), revertingVersion: 0 });
      expect(screen.getByRole('button', { name: 'Wiederherstellen' })).toBeDisabled();
    });
  });

  describe('the card itself', () => {
    it('is outlined so the versions read as separate entries', () => {
      const { container } = renderCard();
      const card = container.firstElementChild as HTMLElement;
      const style = window.getComputedStyle(card);
      expect(style.borderWidth).toBe('1px');
      expect(style.borderStyle).toBe('solid');
    });

    /**
     * The header stacks on a phone and sits on one row from `sm` up. That is a
     * responsive `direction`, and jsdom resolves no media queries, so there is
     * nothing here to assert -- it is left to the responsive screenshot suite.
     */
  });
});
