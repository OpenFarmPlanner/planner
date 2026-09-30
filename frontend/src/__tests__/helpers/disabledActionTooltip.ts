import { waitFor } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

type User = ReturnType<typeof userEvent.setup>;

/**
 * Hovers a control wrapped in `DisabledActionTooltip` and returns *its* tooltip.
 *
 * The wrapper puts the control inside a span and MUI points that span's
 * `aria-describedby` at the popper it renders. Going through the attribute is
 * what ties the text to the control being hovered: a plain
 * `findByRole('tooltip')` returns whichever popper happens to be open, and
 * clicking a button leaves the pointer on it, so its own tooltip is often still
 * showing while a second control is asserted.
 */
export const tooltipOf = async (user: User, control: HTMLElement): Promise<HTMLElement> => {
  const wrapper = control.parentElement as HTMLElement;
  await user.hover(wrapper);
  const id = await waitFor(() => {
    const value = wrapper.getAttribute('aria-describedby');
    expect(value).toBeTruthy();
    return value as string;
  });
  return document.getElementById(id) as HTMLElement;
};

/** Asserts that a `DisabledActionTooltip`-wrapped control explains nothing. */
export const expectNoTooltip = async (user: User, control: HTMLElement): Promise<void> => {
  const wrapper = control.parentElement as HTMLElement;
  await user.hover(wrapper);
  await waitFor(() => expect(wrapper).not.toHaveAttribute('aria-describedby'));
};
