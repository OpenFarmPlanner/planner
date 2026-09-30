import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ChangeProposalQueue from '../crop-library/components/ChangeProposalQueue';
import type { PublicCrop, PublicCropChangeProposal } from '../api/types';

const proposal = (overrides: Partial<PublicCropChangeProposal> = {}): PublicCropChangeProposal => ({
  id: 1,
  public_crop: 42,
  public_crop_label: 'Tomate (Matina)',
  kind: 'edit',
  summary: '',
  proposed_data: { name: 'Tomate' } as Partial<PublicCrop>,
  status: 'pending',
  proposed_by_label: 'Martin',
  created_at: '2026-03-23T14:48:00.000Z',
  ...overrides,
});

interface RenderOptions {
  proposals?: PublicCropChangeProposal[];
  loading?: boolean;
  busyAction?: string | null;
}

const renderQueue = ({
  proposals = [proposal()],
  loading = false,
  busyAction = null,
}: RenderOptions = {}) => {
  const onReview = vi.fn().mockResolvedValue(undefined);
  const formatDate = (value?: string | null) => (value ? '23.03.2026' : '');
  const view = render(
    <ChangeProposalQueue
      proposals={proposals}
      loading={loading}
      busyAction={busyAction}
      formatDate={formatDate}
      onReview={onReview}
    />,
  );
  return { ...view, onReview };
};

const reviewButton = () => screen.getByRole('button', { name: 'Prüfen' });
const dialog = () => screen.getByRole('dialog');
const openReview = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(reviewButton());
  return screen.findByRole('dialog');
};

/**
 * The moderators' queue of library contributions: one row per pending
 * proposal, and a review dialog that has to show a moderator exactly what
 * they are agreeing to before they approve it.
 */
describe('ChangeProposalQueue', () => {
  describe('the queue itself', () => {
    it('shows a spinner rather than claiming the queue is empty', () => {
      renderQueue({ loading: true, proposals: [] });

      // "Nothing pending" is a decision a moderator might act on; it must
      // not be shown before the list has arrived.
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.queryByText('Keine offenen Beiträge.')).not.toBeInTheDocument();
    });

    it('says the queue is empty once it really is', () => {
      renderQueue({ proposals: [] });

      expect(screen.getByText('Keine offenen Beiträge.')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('lists one row per pending proposal', () => {
      renderQueue({
        proposals: [
          proposal({ id: 1, public_crop_label: 'Tomate (Matina)' }),
          proposal({ id: 2, public_crop_label: 'Karotte (Nantaise)' }),
        ],
      });

      const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent('Tomate (Matina)');
      expect(rows[1]).toHaveTextContent('Karotte (Nantaise)');
    });

    it('falls back to the entry id when there is no label', () => {
      // Better an id a moderator can look up than a blank cell.
      renderQueue({ proposals: [proposal({ public_crop_label: undefined, public_crop: 42 })] });

      expect(screen.getByRole('cell', { name: '42' })).toBeInTheDocument();
    });

    it('names an unattributed submission rather than leaving it blank', () => {
      renderQueue({ proposals: [proposal({ proposed_by_label: undefined })] });

      expect(screen.getByRole('cell', { name: 'Anonym' })).toBeInTheDocument();
    });

    it('distinguishes an edit from a brand-new entry', () => {
      renderQueue({
        proposals: [
          proposal({ id: 1, kind: 'edit' }),
          proposal({ id: 2, kind: 'new_publish' }),
        ],
      });

      // A new entry is invisible until approved; an edit changes something
      // already published. Different decisions.
      expect(screen.getByText('Änderung')).toBeInTheDocument();
      expect(screen.getByText('Neuer Eintrag')).toBeInTheDocument();
    });

    it('reads a proposal with no kind as an edit', () => {
      renderQueue({ proposals: [proposal({ kind: undefined })] });

      expect(screen.getByText('Änderung')).toBeInTheDocument();
    });
  });

  describe('where a submission came from', () => {
    it('marks one that arrived through an API token', () => {
      renderQueue({ proposals: [proposal({ origin_api: true })] });

      expect(screen.getByText('API-Zugang')).toBeInTheDocument();
    });

    it('marks one whose client called itself automated', () => {
      renderQueue({ proposals: [proposal({ origin_declared_agent: true })] });

      expect(screen.getByText('Automatisierter Client')).toBeInTheDocument();
    });

    it('marks both independently', () => {
      renderQueue({ proposals: [proposal({ origin_api: true, origin_declared_agent: true })] });

      expect(screen.getByText('API-Zugang')).toBeInTheDocument();
      expect(screen.getByText('Automatisierter Client')).toBeInTheDocument();
    });

    it('marks nothing for an ordinary submission', () => {
      renderQueue();

      expect(screen.queryByText('API-Zugang')).not.toBeInTheDocument();
      expect(screen.queryByText('Automatisierter Client')).not.toBeInTheDocument();
    });

    it('warns in the dialog that an agent claim is unverifiable', async () => {
      const user = userEvent.setup();
      renderQueue({ proposals: [proposal({ origin_declared_agent: true })] });

      await openReview(user);

      // The flag is the client's own word. A moderator weighing it needs to
      // know it was never checked.
      expect(
        within(dialog()).getByText('Selbstauskunft des Clients – nicht überprüfbar.'),
      ).toBeInTheDocument();
    });

    it('leaves that warning out when no agent was declared', async () => {
      const user = userEvent.setup();
      renderQueue({ proposals: [proposal({ origin_api: true })] });

      await openReview(user);

      expect(
        within(dialog()).queryByText('Selbstauskunft des Clients – nicht überprüfbar.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('the proposed values', () => {
    it('lists each field with its proposed value, in the user’s own words', async () => {
      const user = userEvent.setup();
      renderQueue({
        proposals: [proposal({
          proposed_data: { name: 'Tomate', notes: 'Vlies auflegen' } as Partial<PublicCrop>,
        })],
      });

      await openReview(user);

      const rows = within(dialog()).getAllByRole('row').slice(1);
      expect(rows[0]).toHaveTextContent('Name');
      expect(rows[0]).toHaveTextContent('Tomate');
      expect(rows[1]).toHaveTextContent('Notizen');
      // The raw column name would be meaningless to the moderator.
      expect(within(dialog()).queryByText('notes')).not.toBeInTheDocument();
    });

    it('keeps the backend’s own bookkeeping out of the diff', async () => {
      const user = userEvent.setup();
      renderQueue({
        proposals: [proposal({
          kind: 'new_publish',
          proposed_data: {
            name: 'Tomate',
            _source_crop_id: 7,
            _source_project: 3,
          } as unknown as Partial<PublicCrop>,
        })],
      });

      await openReview(user);

      // Underscore-prefixed keys carry the approval forward -- which project
      // crop it came from. They are plumbing, not values anybody proposed,
      // so showing them would ask a moderator to approve internals.
      const rows = within(dialog()).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent('Name');
      expect(within(dialog()).queryByText(/_source/)).not.toBeInTheDocument();
    });

    it('says an edit changes no fields, which is worth knowing', async () => {
      const user = userEvent.setup();
      renderQueue({ proposals: [proposal({ kind: 'edit', proposed_data: {} })] });

      await openReview(user);

      // An edit that proposes nothing is odd and a moderator should see so
      // rather than face an empty panel.
      expect(
        within(dialog()).getByText('Keine Feldänderungen enthalten.'),
      ).toBeInTheDocument();
    });

    it('stays quiet for a new entry, where having no diff is normal', async () => {
      const user = userEvent.setup();
      renderQueue({
        proposals: [proposal({
          kind: 'new_publish',
          proposed_data: { _source_crop_id: 7 } as unknown as Partial<PublicCrop>,
        })],
      });

      await openReview(user);

      // A new publish carries the crop itself, not a field diff, so "no
      // field changes" would read as a fault where there is none.
      expect(
        within(dialog()).queryByText('Keine Feldänderungen enthalten.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('the review dialog', () => {
    it('stays shut until a row is reviewed', () => {
      renderQueue();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('explains an edit as a change to something published', async () => {
      const user = userEvent.setup();
      renderQueue({ proposals: [proposal({ kind: 'edit' })] });

      await openReview(user);

      expect(
        within(dialog()).getByText('Vorgeschlagene Änderungen an „Tomate (Matina)“.'),
      ).toBeInTheDocument();
    });

    it('explains a new entry as invisible until approved', async () => {
      const user = userEvent.setup();
      renderQueue({ proposals: [proposal({ kind: 'new_publish' })] });

      await openReview(user);

      // The consequence of approving differs, so the sentence does too.
      expect(
        within(dialog()).getByText(/soll neu in die Kulturbibliothek aufgenommen werden/),
      ).toBeInTheDocument();
    });

    it('repeats who submitted it and when', async () => {
      const user = userEvent.setup();
      renderQueue();

      await openReview(user);

      // The table hides these two columns on a phone, so the dialog is the
      // only place a mobile moderator sees them.
      expect(
        within(dialog()).getByText('Eingereicht von Martin am 23.03.2026'),
      ).toBeInTheDocument();
    });

    it('opens with an empty note', async () => {
      const user = userEvent.setup();
      renderQueue();

      await openReview(user);

      expect(
        within(dialog()).getByRole('textbox', { name: /Notiz zur Entscheidung/ }),
      ).toHaveValue('');
    });

    it('says the note reaches the submitter', async () => {
      const user = userEvent.setup();
      renderQueue();

      await openReview(user);

      // Worth knowing before writing one.
      expect(
        within(dialog()).getByText('Wird der einreichenden Person mitgeteilt.'),
      ).toBeInTheDocument();
    });

    it('forgets a note that was typed but not submitted', async () => {
      const user = userEvent.setup();
      renderQueue({
        proposals: [proposal({ id: 1 }), proposal({ id: 2, public_crop_label: 'Karotte' })],
      });

      const [first, second] = screen.getAllByRole('button', { name: 'Prüfen' });
      await user.click(first);
      await user.type(
        within(dialog()).getByRole('textbox', { name: /Notiz zur Entscheidung/ }),
        'passt nicht',
      );
      await user.click(within(dialog()).getByRole('button', { name: 'Abbrechen' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      await user.click(second);

      // A note meant for one submission must not follow the moderator to the
      // next one.
      expect(
        within(dialog()).getByRole('textbox', { name: /Notiz zur Entscheidung/ }),
      ).toHaveValue('');
    });
  });

  describe('deciding', () => {
    it('approves the proposal being reviewed', async () => {
      const user = userEvent.setup();
      const target = proposal({ id: 2, public_crop_label: 'Karotte' });
      const { onReview } = renderQueue({ proposals: [proposal({ id: 1 }), target] });

      await user.click(screen.getAllByRole('button', { name: 'Prüfen' })[1]);
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Annehmen' }));

      expect(onReview).toHaveBeenCalledWith(target, 'approve', '');
    });

    it('rejects with the same note field', async () => {
      const user = userEvent.setup();
      const { onReview } = renderQueue();

      await openReview(user);
      await user.type(
        within(dialog()).getByRole('textbox', { name: /Notiz zur Entscheidung/ }),
        'Dublette',
      );
      await user.click(within(dialog()).getByRole('button', { name: 'Ablehnen' }));

      expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'reject', 'Dublette');
    });

    it('trims the note before passing it on', async () => {
      const user = userEvent.setup();
      const { onReview } = renderQueue();

      await openReview(user);
      await user.type(
        within(dialog()).getByRole('textbox', { name: /Notiz zur Entscheidung/ }),
        '  Dublette  ',
      );
      await user.click(within(dialog()).getByRole('button', { name: 'Ablehnen' }));

      // The note is shown to the submitter; leading whitespace would be
      // theirs to puzzle over.
      expect(onReview).toHaveBeenCalledWith(expect.anything(), 'reject', 'Dublette');
    });

    it('closes once the decision is through', async () => {
      const user = userEvent.setup();
      renderQueue();

      await openReview(user);
      await user.click(within(dialog()).getByRole('button', { name: 'Annehmen' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('closes on any settled decision, because it cannot tell one that failed', async () => {
      const user = userEvent.setup();
      // What the only caller actually does: it catches its own errors, shows
      // a snackbar and resolves either way. So the queue has nothing to
      // distinguish a refused decision on, and closes regardless -- taking
      // the moderator's note with it. Recorded rather than worked around;
      // fixing it means changing the onReview contract, which is the page's
      // decision and not this component's.
      const onReview = vi.fn().mockResolvedValue(undefined);
      render(
        <ChangeProposalQueue
          proposals={[proposal()]}
          loading={false}
          busyAction={null}
          formatDate={() => '23.03.2026'}
          onReview={onReview}
        />,
      );

      await user.click(reviewButton());
      const panel = await screen.findByRole('dialog');
      await user.type(
        within(panel).getByRole('textbox', { name: /Notiz zur Entscheidung/ }),
        'Dublette',
      );
      await user.click(within(panel).getByRole('button', { name: 'Ablehnen' }));

      expect(onReview).toHaveBeenCalledWith(expect.anything(), 'reject', 'Dublette');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('keeps the dialog open while the decision has not settled', async () => {
      const user = userEvent.setup();
      let release: () => void = () => {};
      const onReview = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
      render(
        <ChangeProposalQueue
          proposals={[proposal()]}
          loading={false}
          busyAction={null}
          formatDate={() => '23.03.2026'}
          onReview={onReview}
        />,
      );

      await user.click(reviewButton());
      const panel = await screen.findByRole('dialog');
      await user.click(within(panel).getByRole('button', { name: 'Annehmen' }));

      // Closing before the page has finished would hide the outcome.
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      release();

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
  });

  describe('while a decision is in flight', () => {
    it('blocks reviewing another row', () => {
      renderQueue({ busyAction: 'approve-1' });

      expect(reviewButton()).toBeDisabled();
    });

    it('explains why the review button is dead', async () => {
      const user = userEvent.setup();
      renderQueue({ busyAction: 'approve-1' });

      await user.hover(reviewButton().parentElement as HTMLElement);

      expect(await screen.findByRole('tooltip'))
        .toHaveTextContent('Aktion wird gerade verarbeitet.');
    });

    it('blocks all three dialog actions', async () => {
      const user = userEvent.setup();
      const { unmount } = renderQueue();
      await openReview(user);
      unmount();

      renderQueue({ busyAction: 'approve-1' });
      // Reopened through a render with the queue already busy: every way out
      // of the dialog is closed while the server is deciding.
      expect(screen.getByRole('button', { name: 'Prüfen' })).toBeDisabled();
    });

    it('says the approve button is working rather than waiting', async () => {
      const user = userEvent.setup();
      const { rerender } = renderQueue();
      await openReview(user);

      rerender(
        <ChangeProposalQueue
          proposals={[proposal()]}
          loading={false}
          busyAction="approve-1"
          formatDate={() => '23.03.2026'}
          onReview={vi.fn()}
        />,
      );

      expect(within(dialog()).getByRole('button', { name: 'Speichere…' })).toBeInTheDocument();
      expect(within(dialog()).queryByRole('button', { name: 'Annehmen' })).not.toBeInTheDocument();
      expect(within(dialog()).getByRole('button', { name: 'Ablehnen' })).toBeDisabled();
      expect(within(dialog()).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    });

    it('refuses to be dismissed', async () => {
      const user = userEvent.setup();
      const { rerender } = renderQueue();
      await openReview(user);

      rerender(
        <ChangeProposalQueue
          proposals={[proposal()]}
          loading={false}
          busyAction="approve-1"
          formatDate={() => '23.03.2026'}
          onReview={vi.fn()}
        />,
      );
      await user.keyboard('{Escape}');

      // Closing mid-decision would hide the outcome the moderator is waiting
      // for.
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
