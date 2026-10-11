import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocalizedDecimalField } from '../components/inputs/LocalizedDecimalField';

function ControlledField({ initial, onValueChange }: {
  initial: number | string | null;
  onValueChange: (value: number | null) => void;
}) {
  const [value, setValue] = useState<number | string | null>(initial);
  return (
    <LocalizedDecimalField
      label="Saattiefe (cm)"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
    />
  );
}

describe('LocalizedDecimalField', () => {
  it('shows the German decimal separator instead of the browser engine\'s number formatting', () => {
    render(<ControlledField initial={0.5} onValueChange={vi.fn()} />);

    const input = screen.getByLabelText('Saattiefe (cm)');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveValue('0,5');
  });

  it('formats API decimals that arrive as strings', () => {
    render(<ControlledField initial="4.50" onValueChange={vi.fn()} />);

    expect(screen.getByLabelText('Saattiefe (cm)')).toHaveValue('4,5');
  });

  it('keeps the typed text while editing and reformats on blur', () => {
    const onValueChange = vi.fn();
    render(<ControlledField initial={null} onValueChange={onValueChange} />);
    const input = screen.getByLabelText('Saattiefe (cm)');

    fireEvent.change(input, { target: { value: '0,' } });
    expect(input).toHaveValue('0,');
    fireEvent.change(input, { target: { value: '0,75' } });
    expect(onValueChange).toHaveBeenLastCalledWith(0.75);

    fireEvent.change(input, { target: { value: '1.25' } });
    expect(onValueChange).toHaveBeenLastCalledWith(1.25);
    fireEvent.blur(input);
    expect(input).toHaveValue('1,25');
  });

  it('reports a cleared field as null and ignores text that is not a number', () => {
    const onValueChange = vi.fn();
    render(<ControlledField initial={2} onValueChange={onValueChange} />);
    const input = screen.getByLabelText('Saattiefe (cm)');

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '' } });
    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });
});
