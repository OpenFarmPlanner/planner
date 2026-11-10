import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RangeField, type RangeFieldBound } from '../components/inputs/RangeField';

const bound = (overrides: Partial<RangeFieldBound>): RangeFieldBound => ({
  value: null,
  onValueChange: vi.fn(),
  ariaLabel: '',
  ...overrides,
});

function renderRange(props: Partial<Parameters<typeof RangeField>[0]> = {}) {
  return render(
    <RangeField
      label="Sowing depth (cm)"
      from={bound({ ariaLabel: 'Sowing depth from', placeholder: 'From' })}
      to={bound({ ariaLabel: 'Sowing depth to', placeholder: 'To' })}
      invalidRangeText="From must not be greater than To."
      {...props}
    />,
  );
}

describe('RangeField', () => {
  it('renders one outlined field labelled by its visible label, holding two named inputs', () => {
    renderRange();

    const group = screen.getByRole('group', { name: 'Sowing depth (cm)' });
    const from = screen.getByRole('textbox', { name: 'Sowing depth from' });
    const to = screen.getByRole('textbox', { name: 'Sowing depth to' });
    expect(group).toContainElement(from);
    expect(group).toContainElement(to);
    // One outline (and one notched label) around both inputs.
    expect(group.querySelectorAll('.MuiOutlinedInput-root')).toHaveLength(1);
    expect(group.querySelectorAll('fieldset')).toHaveLength(1);
    expect(from.closest('.MuiOutlinedInput-root')).toBe(to.closest('.MuiOutlinedInput-root'));
    expect(screen.getByText('Sowing depth (cm)', { selector: 'label' })).toHaveAttribute('data-shrink', 'true');
    expect(from).toHaveAttribute('placeholder', 'From');
    expect(to).toHaveAttribute('placeholder', 'To');
    expect(from).toHaveClass('MuiInputBase-input');
    expect(to).toHaveClass('MuiInputBase-input');
    expect(screen.queryByText('From must not be greater than To.')).not.toBeInTheDocument();
  });

  it('parses localized decimals per bound and reports a cleared bound as null', () => {
    const onFrom = vi.fn();
    const onTo = vi.fn();
    renderRange({
      from: bound({ ariaLabel: 'Sowing depth from', value: 1.5, onValueChange: onFrom }),
      to: bound({ ariaLabel: 'Sowing depth to', value: 3, onValueChange: onTo }),
    });

    const from = screen.getByRole('textbox', { name: 'Sowing depth from' });
    expect(from).toHaveAttribute('inputmode', 'decimal');
    fireEvent.change(from, { target: { value: '2,5' } });
    expect(onFrom).toHaveBeenCalledWith(2.5);
    fireEvent.change(screen.getByRole('textbox', { name: 'Sowing depth to' }), { target: { value: '' } });
    expect(onTo).toHaveBeenCalledWith(null);
  });

  it('uses whole-number inputs for integer ranges', () => {
    const onFrom = vi.fn();
    renderRange({
      numberKind: 'integer',
      from: bound({ ariaLabel: 'Days from', value: 7, onValueChange: onFrom }),
      to: bound({ ariaLabel: 'Days to', value: 14 }),
    });

    const from = screen.getByRole('spinbutton', { name: 'Days from' });
    expect(from).toHaveAttribute('inputmode', 'numeric');
    expect(from).toHaveAttribute('step', '1');
    fireEvent.change(from, { target: { value: '5' } });
    expect(onFrom).toHaveBeenCalledWith(5);
    expect(screen.getByRole('spinbutton', { name: 'Days to' })).toHaveValue(14);
  });

  it('shows an inline error below the field while From is greater than To', () => {
    renderRange({
      from: bound({ ariaLabel: 'Sowing depth from', value: 3 }),
      to: bound({ ariaLabel: 'Sowing depth to', value: '1.5' }),
    });

    const group = screen.getByRole('group', { name: 'Sowing depth (cm)' });
    const message = screen.getByText('From must not be greater than To.');
    expect(group).toContainElement(message);
    expect(group.querySelector('.MuiOutlinedInput-root')).toHaveClass('Mui-error');
    expect(screen.getByText('Sowing depth (cm)', { selector: 'label' })).toHaveClass('Mui-error');
    for (const name of ['Sowing depth from', 'Sowing depth to']) {
      const input = screen.getByRole('textbox', { name });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription('From must not be greater than To.');
    }
  });

  it('prefers a validation error over the reversed-range message', () => {
    renderRange({
      from: bound({ ariaLabel: 'Sowing depth from', value: 3 }),
      to: bound({ ariaLabel: 'Sowing depth to', value: 1 }),
      error: 'Please enter a valid number.',
    });

    expect(screen.getByText('Please enter a valid number.')).toBeInTheDocument();
    expect(screen.queryByText('From must not be greater than To.')).not.toBeInTheDocument();
  });

  it('shows the focused state on the whole field while either input has focus', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [from, setFrom] = useState<number | null>(null);
      const [to, setTo] = useState<number | null>(null);
      return (
        <RangeField
          label="Sowing depth (cm)"
          from={{ value: from, onValueChange: setFrom, ariaLabel: 'Sowing depth from' }}
          to={{ value: to, onValueChange: setTo, ariaLabel: 'Sowing depth to' }}
          invalidRangeText="From must not be greater than To."
        />
      );
    }
    render(<><Controlled /><button type="button">elsewhere</button></>);

    const root = screen.getByRole('group').querySelector('.MuiOutlinedInput-root');
    const label = screen.getByText('Sowing depth (cm)', { selector: 'label' });
    await user.click(screen.getByRole('textbox', { name: 'Sowing depth from' }));
    expect(root).toHaveClass('Mui-focused');
    expect(label).toHaveClass('Mui-focused');
    await user.keyboard('2');
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Sowing depth to' })).toHaveFocus();
    expect(root).toHaveClass('Mui-focused');
    await user.keyboard('1');
    expect(screen.getByText('From must not be greater than To.')).toBeInTheDocument();
    await user.tab();
    expect(root).not.toHaveClass('Mui-focused');
  });
});
