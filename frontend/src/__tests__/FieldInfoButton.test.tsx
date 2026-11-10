import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, TextField } from '@mui/material';

import { FieldInfoButton } from '../crops/FieldInfoButton';

function FieldInDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose}>
      <TextField
        label="Growth duration (days)"
        slotProps={{
          input: {
            endAdornment: <FieldInfoButton title="Time from planting to harvest start." ariaLabel="Info about Growth duration (days)" />,
          },
        }}
      />
    </Dialog>
  );
}

describe('FieldInfoButton', () => {
  it('opens on click only, not on hovering or focusing the button or the field', async () => {
    const user = userEvent.setup();
    render(<FieldInDialog onClose={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Info about Growth duration (days)' });
    await user.hover(screen.getByLabelText('Growth duration (days)'));
    await user.hover(button);
    button.focus();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.click(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Time from planting to harvest start.');
    // The click does not move focus into the input.
    expect(screen.getByLabelText('Growth duration (days)')).not.toHaveFocus();
    await user.click(button);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('closes on Escape without closing the dialog; a second Escape closes the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FieldInDialog onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Info about Growth duration (days)' }));
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith(expect.anything(), 'escapeKeyDown');
  });
});
