import { fireEvent, render, screen } from '@testing-library/react';
import { Button, MenuItem, MenuList } from '@mui/material';
import { describe, expect, it } from 'vitest';

import { DisabledActionTooltip, DisabledMenuItemTooltip } from '../components/DisabledActionTooltip';

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

  it('surfaces the explanation from the block wrapper of a disabled menu item', async () => {
    render(
      <MenuList>
        <DisabledMenuItemTooltip title="Keine Daten zum Kopieren">
          <MenuItem disabled>Zeile kopieren</MenuItem>
        </DisabledMenuItemTooltip>
      </MenuList>,
    );

    fireEvent.mouseOver(screen.getByText('Zeile kopieren').parentElement as HTMLElement);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Keine Daten zum Kopieren');
  });
});
