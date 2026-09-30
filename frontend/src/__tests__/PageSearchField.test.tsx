import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PageSearchField } from '../search/PageSearchField';

interface RenderOptions {
  value?: string;
  variant?: 'toolbar' | 'rounded';
  shortcutHint?: string;
}

const renderField = ({ value = '', variant, shortcutHint }: RenderOptions = {}) => {
  const onChange = vi.fn();
  const onClear = vi.fn();
  const view = render(
    <PageSearchField
      value={value}
      onChange={onChange}
      onClear={onClear}
      placeholder="Anbaupläne durchsuchen"
      ariaLabel="Anbaupläne durchsuchen"
      clearLabel="Suche löschen"
      variant={variant}
      shortcutHint={shortcutHint}
    />,
  );
  return { ...view, onChange, onClear };
};

const input = () => screen.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' });

/**
 * The shared page-search input. Page search sits on the page rather than in
 * the topbar, which is reserved for a later app-wide search (docs/search.md).
 * Everything here is about the input itself; what a page does with the text
 * is the page's own business.
 *
 * One rule is deliberately unpinned: the field hides WebKit's own
 * `::-webkit-search-cancel-button`, which would otherwise sit beside the
 * clear button as a second cross. jsdom computes no styles for vendor
 * pseudo-elements, so any assertion on it would hold whether or not the rule
 * is there.
 */
describe('PageSearchField', () => {
  it('is a search box with its own accessible name', () => {
    renderField();

    // The placeholder disappears as soon as there is text, so the name has
    // to come from somewhere that does not.
    expect(input()).toHaveAttribute('type', 'search');
    expect(input()).toHaveAccessibleName('Anbaupläne durchsuchen');
  });

  it('reports each keystroke', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();

    await user.type(input(), 'ka');

    // Uncontrolled here, so both calls carry a single character: the page
    // owns the value and feeds it back.
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('turns off autocomplete, which would cover the live results', () => {
    renderField();

    expect(input()).toHaveAttribute('autocomplete', 'off');
  });

  it('asks a phone keyboard for a search key', () => {
    renderField();

    expect(input()).toHaveAttribute('enterkeyhint', 'search');
  });

  describe('the clear button', () => {
    it('is absent while the field is empty', () => {
      // Nothing to clear, so no target to mis-hit.
      renderField({ value: '' });

      expect(screen.queryByRole('button', { name: 'Suche löschen' })).not.toBeInTheDocument();
    });

    it('appears once there is text', () => {
      renderField({ value: 'karotte' });

      expect(screen.getByRole('button', { name: 'Suche löschen' })).toBeInTheDocument();
    });

    it('clears without reporting a keystroke', async () => {
      const user = userEvent.setup();
      const { onClear, onChange } = renderField({ value: 'karotte' });

      await user.click(screen.getByRole('button', { name: 'Suche löschen' }));

      // Clearing is its own path, not an empty change: the page clears
      // instantly rather than through the search debounce.
      expect(onClear).toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Escape', () => {
    it('clears a field with text in it', async () => {
      const user = userEvent.setup();
      const { onClear } = renderField({ value: 'karotte' });

      input().focus();
      await user.keyboard('{Escape}');

      expect(onClear).toHaveBeenCalled();
    });

    it('is left alone when the field is already empty', async () => {
      const user = userEvent.setup();
      const { onClear } = renderField({ value: '' });

      input().focus();
      await user.keyboard('{Escape}');

      // An empty field has nothing to clear, so Escape belongs to whatever
      // is around it -- a dialog or a popover that should close.
      expect(onClear).not.toHaveBeenCalled();
    });

    it('is kept from also closing whatever is behind it', () => {
      const { onClear } = renderField({ value: 'karotte' });
      const field = input();

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(event);

      // Clearing the search and closing the surrounding panel on one press
      // would lose the search without the user asking.
      expect(onClear).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores other keys', async () => {
      const user = userEvent.setup();
      const { onClear } = renderField({ value: 'karotte' });

      input().focus();
      await user.keyboard('{Enter}{Tab}');

      expect(onClear).not.toHaveBeenCalled();
    });
  });

  describe('the shortcut hint', () => {
    it('shows the key that focuses the field', () => {
      renderField({ value: '', shortcutHint: '/' });

      expect(screen.getByText('/')).toBeInTheDocument();
      expect(input()).toHaveAttribute('aria-keyshortcuts', '/');
    });

    it('is decoration, so it is not read out twice', () => {
      renderField({ value: '', shortcutHint: '/' });

      // The shortcut is already announced through aria-keyshortcuts; the
      // visible key is there for the eye.
      expect(screen.getByText('/').closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('gives way to the clear button once there is text', () => {
      renderField({ value: 'karotte', shortcutHint: '/' });

      // One end adornment: the hint is advice for an empty field, the clear
      // button an action for a full one.
      expect(screen.queryByText('/')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Suche löschen' })).toBeInTheDocument();
    });

    it('is left out when no shortcut is offered', () => {
      renderField({ value: '' });

      expect(input()).not.toHaveAttribute('aria-keyshortcuts');
    });
  });

  it('hands its input element to the page, so a shortcut can focus it', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <PageSearchField
        value=""
        onChange={vi.fn()}
        onClear={vi.fn()}
        placeholder="Suchen"
        ariaLabel="Suchen"
        clearLabel="Löschen"
        inputRef={ref}
      />,
    );

    expect(ref.current).toBe(screen.getByRole('searchbox'));
  });
});
