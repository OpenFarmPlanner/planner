import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCropDiscussionComment } from '../api/types';
import i18n from '../i18n/config';
import {
  DiscussionComment,
  type DiscussionCommentProps,
} from '../crop-library/components/publicCropLibrary/DiscussionComment';
import { MAX_VISIBLE_REPLY_DEPTH } from '../crop-library/components/publicCropLibrary/formatters';

/**
 * The real German bundle rather than a passthrough, bound to the same
 * namespace the page binds (`crops`): several branches here differ only in
 * which sentence they render -- the three deleted-comment placeholders are
 * the clearest case -- so a stub `t` would let any two of them be swapped
 * without a test noticing.
 */
const fixedT = i18n.getFixedT('de', 'crops');
const t = (key: string, options?: Record<string, unknown>) => fixedT(key, options) as string;

const comment = (overrides: Partial<PublicCropDiscussionComment> = {}): PublicCropDiscussionComment => ({
  id: 1,
  topic: 10,
  body: 'Sehr guter Hinweis.',
  created_by_label: 'Martina',
  created_at: '2026-03-15T08:00:00Z',
  deleted_at: null,
  deletion_kind: null,
  delete_blocked_reason: null,
  is_edited: false,
  can_edit: false,
  can_delete: false,
  ...overrides,
} as PublicCropDiscussionComment);

const handlers = () => ({
  onReply: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onDeleteBlocked: vi.fn(),
  onOpenMenu: vi.fn(),
  onCloseMenu: vi.fn(),
  onCancelEdit: vi.fn(),
  onCommentSubmit: vi.fn(),
  onCommentBodyChange: vi.fn(),
  registerReplyActionRef: vi.fn(),
  registerCommentRef: vi.fn(),
});

type Handlers = ReturnType<typeof handlers>;

const setup = (overrides: Partial<DiscussionCommentProps> = {}) => {
  const spies: Handlers = handlers();
  const props: DiscussionCommentProps = {
    comment: comment(),
    anonymousLabel: 'Anonym',
    formatDate: () => '15.03.2026',
    isReply: false,
    logicalDepth: 0,
    visualDepth: 0,
    isEditing: false,
    menuAnchorElement: null,
    submittingComment: false,
    commentBody: '',
    t,
    activeFormInputRef: { current: null },
    ...spies,
    ...overrides,
  };
  const view = render(<DiscussionComment {...props} />);
  return { ...view, ...spies, props };
};

const replyButton = (author = 'Martina') =>
  screen.getByRole('button', { name: `Auf Beitrag von ${author} antworten` });
const moreButton = () => screen.queryByRole('button', { name: 'Weitere Aktionen' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('what the comment shows', () => {
  it('renders the body and who wrote it when', () => {
    setup();

    expect(screen.getByText('Sehr guter Hinweis.')).toBeInTheDocument();
    expect(screen.getByText('Martina · 15.03.2026')).toBeInTheDocument();
  });

  it('falls back to the anonymous label when there is no author', () => {
    // Library comments can come from an account that has since been removed.
    // The reply action is checked too: it names the author separately, so
    // the fallback has to be applied in both places or the button reads as
    // "Auf Beitrag von  antworten".
    setup({ comment: comment({ created_by_label: '' }) });

    expect(screen.getByText('Anonym · 15.03.2026')).toBeInTheDocument();
    expect(replyButton('Anonym')).toBeInTheDocument();
  });

  it('marks an edited comment as edited', () => {
    // Readers need to know the text they are replying to may have changed.
    setup({ comment: comment({ is_edited: true }) });

    expect(screen.getByText('Martina · 15.03.2026 · bearbeitet')).toBeInTheDocument();
  });

  it('does not mark an unedited comment', () => {
    setup();

    expect(screen.queryByText(/bearbeitet/)).not.toBeInTheDocument();
  });

  it('uses the date formatter it was given', () => {
    // The page formats dates in the active locale; the component must not
    // format them itself.
    const formatDate = vi.fn(() => '1. März');
    setup({ formatDate });

    expect(formatDate).toHaveBeenCalledWith('2026-03-15T08:00:00Z');
    expect(screen.getByText('Martina · 1. März')).toBeInTheDocument();
  });
});

describe('a deleted comment', () => {
  it.each([
    ['author', 'Dieser Beitrag wurde vom Autor gelöscht.'],
    ['moderator', 'Dieser Beitrag wurde von einem Moderator entfernt.'],
  ] as const)('says so in the %s\'s words', (kind, expected) => {
    // Who removed it is the point: a moderator removal reads differently to
    // the thread than an author changing their mind.
    setup({ comment: comment({ deleted_at: '2026-03-16T08:00:00Z', deletion_kind: kind }) });

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('falls back to the neutral wording when the kind is unknown', () => {
    setup({ comment: comment({ deleted_at: '2026-03-16T08:00:00Z', deletion_kind: null }) });

    expect(screen.getByText('Dieser Beitrag wurde gelöscht.')).toBeInTheDocument();
  });

  it('does not show the original text', () => {
    setup({ comment: comment({ deleted_at: '2026-03-16T08:00:00Z' }) });

    expect(screen.queryByText('Sehr guter Hinweis.')).not.toBeInTheDocument();
  });

  it('offers no actions on it', () => {
    // Nothing can be replied to, edited or deleted once it is gone; the row
    // stays only to keep its replies attached to something.
    setup({
      comment: comment({ deleted_at: '2026-03-16T08:00:00Z', can_edit: true, can_delete: true }),
    });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('still shows who wrote it and when', () => {
    setup({ comment: comment({ deleted_at: '2026-03-16T08:00:00Z' }) });

    expect(screen.getByText('Martina · 15.03.2026')).toBeInTheDocument();
  });
});

describe('replying', () => {
  it('offers a reply action naming the author', () => {
    // Threads nest, so "Antworten" alone would not say which comment.
    setup();

    expect(replyButton()).toBeInTheDocument();
  });

  it('asks the page to start a reply', async () => {
    const user = userEvent.setup();
    const { onReply } = setup();

    await user.click(replyButton());

    expect(onReply).toHaveBeenCalledWith(1);
  });

  it('is disabled while writing is blocked', () => {
    // A species awaiting moderation can still be read but not written to.
    // Asserted on the disabled state alone: a disabled MUI button also has
    // `pointer-events: none`, which userEvent refuses to click through, so
    // there is no click to make and nothing further to observe.
    setup({ writingDisabled: true });

    expect(replyButton()).toBeDisabled();
  });

  it('hands its button back so the page can restore focus', () => {
    // Cancelling a reply puts focus back on the action that opened it.
    const { registerReplyActionRef } = setup();

    expect(registerReplyActionRef).toHaveBeenCalledWith(1, expect.any(HTMLButtonElement));
  });

  it('hands its own element back too', () => {
    // Used to scroll a linked comment into view.
    const { registerCommentRef } = setup();

    expect(registerCommentRef).toHaveBeenCalledWith(1, expect.any(HTMLElement));
  });
});

describe('the actions menu', () => {
  it('is absent for a comment the reader may not change', () => {
    // A stranger's comment offers only the reply action.
    setup();

    expect(moreButton()).not.toBeInTheDocument();
  });

  it('appears when the comment can be edited', () => {
    setup({ comment: comment({ can_edit: true }) });

    expect(moreButton()).toBeInTheDocument();
  });

  it('appears when the comment can be deleted', () => {
    setup({ comment: comment({ can_delete: true }) });

    expect(moreButton()).toBeInTheDocument();
  });

  it('appears when deleting is blocked, so the reason can be explained', () => {
    // The action stays reachable precisely to tell the user why it will not
    // work, rather than vanishing with no explanation.
    setup({ comment: comment({ delete_blocked_reason: 'visible_replies' }) });

    expect(moreButton()).toBeInTheDocument();
  });

  it('asks the page to open it, handing over the button it is anchored to', async () => {
    const user = userEvent.setup();
    const { onOpenMenu } = setup({ comment: comment({ can_edit: true }) });

    await user.click(moreButton()!);

    expect(onOpenMenu).toHaveBeenCalledWith(1, expect.any(HTMLButtonElement));
  });

  it('reports itself closed to assistive technology while it is', () => {
    setup({ comment: comment({ can_edit: true }) });

    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
    expect(moreButton()).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('reports itself open once the page anchors it', () => {
    // Queried including hidden elements: an open MUI menu is modal and marks
    // the rest of the document aria-hidden, so the trigger is no longer in
    // the accessibility tree -- which is the behaviour, not a problem.
    const anchor = document.createElement('button');
    document.body.append(anchor);
    setup({ comment: comment({ can_edit: true }), menuAnchorElement: anchor });

    expect(screen.getByRole('button', { name: 'Weitere Aktionen', hidden: true }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('stays closed until the page says otherwise', () => {
    // The open state lives on the page, since only one comment's menu may be
    // open at a time across the whole thread.
    setup({ comment: comment({ can_edit: true }) });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('the open menu', () => {
  const openMenu = (overrides: Partial<PublicCropDiscussionComment>) => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    return setup({ comment: comment(overrides), menuAnchorElement: anchor });
  };

  it('offers editing only to someone who may edit', () => {
    openMenu({ can_delete: true });

    expect(within(screen.getByRole('menu')).queryByText('Bearbeiten')).not.toBeInTheDocument();
    expect(within(screen.getByRole('menu')).getByText('Löschen')).toBeInTheDocument();
  });

  it('offers deleting only to someone who may delete', () => {
    openMenu({ can_edit: true });

    expect(within(screen.getByRole('menu')).getByText('Bearbeiten')).toBeInTheDocument();
    expect(within(screen.getByRole('menu')).queryByText('Löschen')).not.toBeInTheDocument();
  });

  it('starts an edit and closes itself', async () => {
    const user = userEvent.setup();
    const { onEdit, onCloseMenu, props } = openMenu({ can_edit: true });

    await user.click(screen.getByText('Bearbeiten'));

    expect(onCloseMenu).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalledWith(props.comment);
  });

  it('deletes and closes itself', async () => {
    const user = userEvent.setup();
    const { onDelete, onCloseMenu } = openMenu({ can_delete: true });

    await user.click(screen.getByText('Löschen'));

    expect(onCloseMenu).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it('explains instead of deleting when replies are in the way', async () => {
    // Removing a comment that still has visible replies would orphan them,
    // so the page says why rather than doing it.
    const user = userEvent.setup();
    const { onDelete, onDeleteBlocked } = openMenu({ delete_blocked_reason: 'visible_replies' });

    await user.click(screen.getByText('Löschen'));

    expect(onDeleteBlocked).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('explains rather than deleting even for someone who may delete', async () => {
    // The block is about the thread's shape, not about permission, so it
    // applies to a moderator too.
    const user = userEvent.setup();
    const { onDelete, onDeleteBlocked } = openMenu({
      can_delete: true, delete_blocked_reason: 'visible_replies',
    });

    await user.click(screen.getByText('Löschen'));

    expect(onDeleteBlocked).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('editing in place', () => {
  it('replaces the text with a form holding it', () => {
    setup({ comment: comment({ can_edit: true }), isEditing: true, commentBody: 'Neuer Text' });

    expect(screen.queryByText('Sehr guter Hinweis.')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Neuer Text')).toBeInTheDocument();
  });

  it('hides the actions while the form is open', () => {
    // The reply and menu buttons would sit beside a form that already has
    // its own submit and cancel.
    setup({ comment: comment({ can_edit: true }), isEditing: true });

    expect(screen.queryByRole('button', { name: /antworten/i })).not.toBeInTheDocument();
    expect(moreButton()).not.toBeInTheDocument();
  });

  it.each([
    ['a submit is in flight', { submittingComment: true }],
    ['writing is blocked', { writingDisabled: true }],
  ])('blocks submitting while %s', (_label, overrides) => {
    // It is the submit that is blocked, not the typing: the text field stays
    // editable in both cases, so a slow save or a species awaiting
    // moderation does not throw away what the user has written.
    setup({
      comment: comment({ can_edit: true }),
      isEditing: true,
      commentBody: 'Geänderter Text',
      ...overrides,
    });

    expect(screen.getByRole('button', { name: 'Absenden' })).toBeDisabled();
    expect(screen.getByLabelText('Kommentar')).toBeEnabled();
  });

  it('allows submitting otherwise', () => {
    setup({ comment: comment({ can_edit: true }), isEditing: true, commentBody: 'Geänderter Text' });

    expect(screen.getByRole('button', { name: 'Absenden' })).toBeEnabled();
  });

  it('blocks submitting an empty comment', () => {
    // An edit that clears the text is a deletion, which has its own action.
    setup({ comment: comment({ can_edit: true }), isEditing: true, commentBody: '   ' });

    expect(screen.getByRole('button', { name: 'Absenden' })).toBeDisabled();
  });

  it('reports what the user types', async () => {
    const user = userEvent.setup();
    const { onCommentBodyChange } = setup({
      comment: comment({ can_edit: true }), isEditing: true, commentBody: '',
    });

    await user.type(screen.getByLabelText('Kommentar'), 'A');

    expect(onCommentBodyChange).toHaveBeenCalledWith('A');
  });
});

describe('nesting', () => {
  it('names the comment being answered once the indent stops growing', () => {
    // Past the indent cap the visual nesting no longer shows who is being
    // replied to, so it is said in words instead.
    setup({
      isReply: true,
      logicalDepth: MAX_VISIBLE_REPLY_DEPTH + 1,
      visualDepth: MAX_VISIBLE_REPLY_DEPTH,
      parentAuthorLabel: 'Jonas',
    });

    expect(screen.getByText('Antwort auf Jonas')).toBeInTheDocument();
  });

  it('does not name it while the indent still shows it', () => {
    setup({
      isReply: true,
      logicalDepth: MAX_VISIBLE_REPLY_DEPTH,
      visualDepth: MAX_VISIBLE_REPLY_DEPTH,
      parentAuthorLabel: 'Jonas',
    });

    expect(screen.queryByText('Antwort auf Jonas')).not.toBeInTheDocument();
  });

  it('does not name it on a top-level comment', () => {
    setup({ isReply: false, logicalDepth: MAX_VISIBLE_REPLY_DEPTH + 1, parentAuthorLabel: 'Jonas' });

    expect(screen.queryByText('Antwort auf Jonas')).not.toBeInTheDocument();
  });

  it('does not name an author it was not given', () => {
    setup({ isReply: true, logicalDepth: MAX_VISIBLE_REPLY_DEPTH + 1 });

    expect(screen.queryByText(/Antwort auf/)).not.toBeInTheDocument();
  });

  it('records both depths on the element for the thread layout', () => {
    const { container } = setup({ isReply: true, logicalDepth: 5, visualDepth: 3 });
    const element = container.querySelector('[data-comment-id="1"]');

    expect(element).toHaveAttribute('data-logical-depth', '5');
    expect(element).toHaveAttribute('data-visual-depth', '3');
  });

  it('is focusable programmatically but not by tabbing', () => {
    // The page moves focus here to show a linked comment; it must not add a
    // tab stop per comment to a long thread.
    const { container } = setup();

    expect(container.querySelector('[data-comment-id="1"]')).toHaveAttribute('tabindex', '-1');
  });
});
