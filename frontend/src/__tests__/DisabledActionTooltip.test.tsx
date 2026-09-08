import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '@mui/material';
import { describe, expect, it } from 'vitest';

import { DisabledActionTooltip } from '../components/DisabledActionTooltip';

describe('DisabledActionTooltip', () => {
  it('surfaces the explanation from the wrapper of a disabled control', async () => {
    render(
      <DisabledActionTooltip title="Bitte zuerst auswählen">
        <Button disabled>Speichern</Button>
      </DisabledActionTooltip>,
    );

    fireEvent.mouseOver(screen.getByText('Speichern').parentElement as HTMLElement);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bitte zuerst auswählen');
  });
});
