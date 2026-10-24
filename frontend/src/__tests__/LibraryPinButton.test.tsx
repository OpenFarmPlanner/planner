import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';
import { LibraryPinButton } from '../crops/LibraryPinButton';

const t = i18n.getFixedT('de', 'crops');

describe('LibraryPinButton', () => {
  it('names the library value in its label and tooltip', async () => {
    render(<LibraryPinButton libraryValue="60" onUnpin={vi.fn()} t={t} />);

    const pin = screen.getByTestId('crop-form-library-pin');
    expect(pin).toHaveAccessibleName('Lokal fixiert, Bibliothek: 60');
    fireEvent.mouseOver(pin);
    expect(await screen.findByRole('tooltip', {}, { timeout: 4000 }))
      .toHaveTextContent('Lokal fixiert. Bibliothek: 60.');
  });

  it('releases the pin only through the popover button', async () => {
    const onUnpin = vi.fn();
    render(<LibraryPinButton libraryValue="60" onUnpin={onUnpin} t={t} />);

    fireEvent.click(screen.getByTestId('crop-form-library-pin'));
    const popover = await screen.findByRole('dialog', { name: 'Lokal fixiert' });
    expect(popover).toHaveTextContent('Bibliothek: 60');
    expect(onUnpin).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Fixierung lösen' }));
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it('focuses "Fixierung lösen" in the popover for keyboard use', async () => {
    render(<LibraryPinButton libraryValue="60" onUnpin={vi.fn()} t={t} />);

    fireEvent.click(screen.getByTestId('crop-form-library-pin'));
    const unpin = await screen.findByRole('button', { name: 'Fixierung lösen' });
    await waitFor(() => expect(unpin).toHaveFocus());
  });
});
