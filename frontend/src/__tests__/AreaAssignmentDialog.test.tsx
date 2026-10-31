import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Bed, BedSuggestion, Field, Location, RotationFinding } from '../api/types';
import {
  AreaAssignmentDialog,
  type AreaAssignmentRotationContext,
} from '../components/planting-plans/AreaAssignmentDialog';
import { getAreaHierarchyIndex } from '../components/planting-plans/areaHierarchySelection';
import { resetPlantFamiliesCache } from '../crops/plantFamilies';

const apiMocks = vi.hoisted(() => ({
  bedSuggestions: vi.fn(),
  rotationCheck: vi.fn(),
  plantFamilies: vi.fn(),
}));
vi.mock('../api/api', () => ({
  plantingPlanAPI: { bedSuggestions: apiMocks.bedSuggestions, rotationCheck: apiMocks.rotationCheck },
  plantFamilyAPI: { list: apiMocks.plantFamilies },
}));

const locations: Location[] = [
  { id: 1, name: 'Regenbogenland' },
  { id: 2, name: 'Sonnengarten' },
  { id: 3, name: 'Leerstandort' },
];

const fields: Field[] = [
  { id: 11, name: '8 Karotte + Zwiebel', location: 1 },
  { id: 12, name: '9 Pastinake', location: 1 },
  { id: 21, name: '5 Tomate', location: 2 },
  { id: 31, name: 'Ohne Beete', location: 3 },
];

const beds: Bed[] = [
  { id: 101, name: '5', field: 11, field_name: '8 Karotte + Zwiebel', area_sqm: 10 },
  { id: 102, name: '6', field: 12, field_name: '9 Pastinake', area_sqm: 8 },
  { id: 201, name: '5', field: 21, field_name: '5 Tomate', area_sqm: 12.5 },
];

const openDialog = async (): Promise<void> => {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('Anbaufläche bearbeiten'));
  expect(await screen.findByRole('dialog', { name: 'Anbaufläche ändern' })).toBeInTheDocument();
};

const openSelect = async (label: string): Promise<void> => {
  const user = userEvent.setup();
  const trigger = screen.getByRole('combobox', { name: label });
  await user.click(trigger);
};

const expectFocusAfterTab = async (user: ReturnType<typeof userEvent.setup>, element: HTMLElement): Promise<void> => {
  await user.tab();
  await waitFor(() => {
    expect(element).toHaveFocus();
  });
};

const expectCurrentFocus = async (element: HTMLElement): Promise<void> => {
  await waitFor(() => {
    expect(element).toHaveFocus();
  });
};

const pressShiftTab = (element: HTMLElement): void => {
  fireEvent.keyDown(element, {
    key: 'Tab',
    shiftKey: true,
  });
};

/** Renders the dialog between focusable page elements, so a Tab that escapes
 * the modal overlay lands on one of them instead of silently passing. */
const renderWithPageBackground = (
  props: Partial<Parameters<typeof AreaAssignmentDialog>[0]> = {},
): void => {
  render(
    <>
      <button type="button">Navigation davor</button>
      <AreaAssignmentDialog
        bedId={101}
        beds={beds}
        fields={fields}
        locations={locations}
        locale="de-DE"
        compactLabel="x"
        onApply={vi.fn()}
        {...props}
      />
      <button type="button">Tabellenzelle danach</button>
    </>,
  );
};

const getDialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Anbaufläche ändern' });

const expectFocusInsideDialog = (): void => {
  const active = document.activeElement;
  expect(active).not.toBeNull();
  expect(getDialog().contains(active)).toBe(true);
};

describe('getAreaHierarchyIndex', () => {
  it('derives the growing-area hierarchy once per data set instead of per cell', () => {
    // Every row of the planting-plan grid renders one AreaAssignmentDialog,
    // and each of them needs this hierarchy. Rebuilding it per cell made
    // scrolling a large project (thousands of beds) walk the whole bed list
    // again for every row that came into view.
    const first = getAreaHierarchyIndex(locations, fields, beds);
    const second = getAreaHierarchyIndex(locations, fields, beds);

    expect(second).toBe(first);
    expect(getAreaHierarchyIndex(locations, fields, [...beds])).not.toBe(first);
  });

  it('groups beds under their field and hides locations without beds', () => {
    const { bedsWithLocation, bedsByFieldId, fieldsByLocationId, selectableLocations } =
      getAreaHierarchyIndex(locations, fields, beds);

    expect(bedsWithLocation.map((bed) => bed.id)).toEqual([101, 102, 201]);
    expect(bedsWithLocation[0]).toMatchObject({ fieldId: 11, locationId: 1 });
    expect(bedsByFieldId.get(11)?.map((bed) => bed.id)).toEqual([101]);
    expect(fieldsByLocationId.get(1)?.map((field) => field.id)).toEqual([11, 12]);
    // 'Leerstandort' has a field but no beds, so it must not be selectable.
    expect(selectableLocations.map((location) => location.id)).toEqual([1, 2]);
  });
});

describe('AreaAssignmentDialog', () => {
  it('opens on a single click on the cell without a separate edit affordance', async () => {
    const user = userEvent.setup();
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="Regenbogenland · 8 Karotte + Zwiebel · 5" onApply={vi.fn()} />,
    );

    const trigger = screen.getByRole('button', { name: 'Anbaufläche bearbeiten' });
    expect(screen.getAllByRole('button')).toEqual([trigger]);
    expect(trigger).toHaveTextContent('Regenbogenland · 8 Karotte + Zwiebel · 5');

    await user.click(trigger);

    expect(await screen.findByRole('dialog', { name: 'Anbaufläche ändern' })).toBeInTheDocument();
  });

  it('opens with Enter while the grid cell owns the focus', async () => {
    const user = userEvent.setup();
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" hasFocus onApply={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Anbaufläche bearbeiten' })).toHaveFocus();
    });
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog', { name: 'Anbaufläche ändern' })).toBeInTheDocument();
  });

  it('returns focus to the cell trigger after the dialog closes', async () => {
    const user = userEvent.setup();
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" hasFocus onApply={vi.fn()} />,
    );

    await openDialog();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Anbaufläche bearbeiten' })).toHaveFocus();
    });
  });

  it('opens with current location/field/bed selection', async () => {
    render(
      <AreaAssignmentDialog
        bedId={101}
        beds={beds}
        fields={fields}
        locations={locations}
        locale="de-DE"
        compactLabel="Regenbogenland · 8 Karotte + Zwiebel · 5 (10,00 m²)"
        onApply={vi.fn()}
      />,
    );

    await openDialog();

    expect(screen.getByRole('combobox', { name: 'Standort' })).toHaveTextContent('Regenbogenland');
    expect(screen.getByRole('combobox', { name: 'Parzelle' })).toHaveTextContent('8 Karotte + Zwiebel');
    expect(screen.getByRole('combobox', { name: 'Beet' })).toHaveTextContent(/5 \(10,00\s+m²\)/);
  });

  it('keeps the stacked field controls compact inside the dialog', async () => {
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={vi.fn()} />,
    );

    await openDialog();

    const fieldControls = ['Standort', 'Parzelle', 'Beet'].map((label) =>
      screen.getByRole('combobox', { name: label }).closest('.MuiFormControl-root'),
    );

    for (const control of fieldControls) {
      expect(control).not.toBeNull();
      expect(control).not.toHaveStyle({ flex: '0 1 300px' });
    }
  });

  it('filters fields and beds when location changes', async () => {
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={vi.fn()} />,
    );

    await openDialog();
    await openSelect('Standort');
    await userEvent.setup().click(screen.getByRole('option', { name: 'Sonnengarten' }));

    await openSelect('Parzelle');
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: '5 Tomate' })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: 'Ohne Beete' })).not.toBeInTheDocument();
  });

  it('filters beds when field changes', async () => {
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={vi.fn()} />,
    );

    await openDialog();
    await openSelect('Parzelle');
    await userEvent.setup().click(screen.getByRole('option', { name: '9 Pastinake' }));

    await openSelect('Beet');
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /^6 \(8,00\s+m²\)$/ })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: '5 (10,00 m²)' })).not.toBeInTheDocument();
  });

  it('shows bed option labels without redundant field names', async () => {
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={vi.fn()} />,
    );

    await openDialog();
    await openSelect('Beet');
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /^5 \(10,00\s+m²\)$/ })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: '8 Karotte + Zwiebel | 5 (10,00 m²)' })).not.toBeInTheDocument();
  });

  it('sets location and field automatically when bed changes', async () => {
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={vi.fn()} />,
    );

    await openDialog();
    await openSelect('Standort');
    await userEvent.setup().click(screen.getByRole('option', { name: 'Sonnengarten' }));
    await openSelect('Parzelle');
    await userEvent.setup().click(screen.getByRole('option', { name: '5 Tomate' }));
    await openSelect('Beet');
    await userEvent.setup().click(screen.getByRole('option', { name: /^5 \(12,50\s+m²\)$/ }));

    expect(screen.getByRole('combobox', { name: 'Standort' })).toHaveTextContent('Sonnengarten');
    expect(screen.getByRole('combobox', { name: 'Parzelle' })).toHaveTextContent('5 Tomate');
    expect(screen.getByRole('combobox', { name: 'Beet' })).toHaveTextContent(/5 \(12,50\s+m²\)/);
  });

  it('applies the changed bed selection', async () => {
    const onApply = vi.fn();
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={onApply} />,
    );

    await openDialog();
    await openSelect('Parzelle');
    await userEvent.setup().click(screen.getByRole('option', { name: '9 Pastinake' }));
    await openSelect('Beet');
    await userEvent.setup().click(screen.getByRole('option', { name: /^6 \(8,00\s+m²\)$/ }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Übernehmen' }));

    expect(onApply).toHaveBeenCalledWith(102, { freeAreaSqm: null });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Anbaufläche ändern' })).not.toBeInTheDocument();
    });
  });

  it('cancels dialog changes without applying', async () => {
    const onApply = vi.fn();
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={onApply} />,
    );

    await openDialog();
    await openSelect('Parzelle');
    await userEvent.setup().click(screen.getByRole('option', { name: '9 Pastinake' }));
    await openSelect('Beet');
    await userEvent.setup().click(screen.getByRole('option', { name: /^6 \(8,00\s+m²\)$/ }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(onApply).not.toHaveBeenCalled();

    await openDialog();
    expect(screen.getByRole('combobox', { name: 'Beet' })).toHaveTextContent(/5 \(10,00\s+m²\)/);
  });

  it('keeps the location selector visible when only one selectable location exists', async () => {
    const singleLocationFields: Field[] = [
      { id: 11, name: '8 Karotte + Zwiebel', location: 1 },
      { id: 12, name: '9 Pastinake', location: 1 },
    ];

    render(
      <AreaAssignmentDialog
        bedId={101}
        beds={beds.filter((item) => item.id !== 201)}
        fields={singleLocationFields}
        locations={locations}
        locale="de-DE"
        compactLabel="x"
        onApply={vi.fn()}
      />,
    );

    await openDialog();
    expect(screen.getByRole('combobox', { name: 'Standort' })).toHaveTextContent('Regenbogenland');
    expect(screen.getByRole('combobox', { name: 'Parzelle' })).toBeInTheDocument();
  });

  it('does not apply the dialog when Enter is used inside an opened dropdown', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={onApply} />,
    );

    await openDialog();
    await user.click(screen.getByRole('combobox', { name: 'Standort' }));
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Anbaufläche ändern' })).toBeInTheDocument();
  });

  it('follows logical tab order and supports Enter on action buttons', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={onApply} />,
    );

    await openDialog();
    await expectCurrentFocus(screen.getByRole('combobox', { name: 'Standort' }));
    await expectFocusAfterTab(user, screen.getByRole('combobox', { name: 'Parzelle' }));
    await expectFocusAfterTab(user, screen.getByRole('combobox', { name: 'Beet' }));
    await expectFocusAfterTab(user, screen.getByRole('button', { name: 'Abbrechen' }));
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Anbaufläche ändern' })).not.toBeInTheDocument();
    });

    await openDialog();
    const applyButton = screen.getByRole('button', { name: 'Übernehmen' });
    await expectCurrentFocus(screen.getByRole('combobox', { name: 'Standort' }));
    await expectFocusAfterTab(user, screen.getByRole('combobox', { name: 'Parzelle' }));
    await expectFocusAfterTab(user, screen.getByRole('combobox', { name: 'Beet' }));
    await expectFocusAfterTab(user, screen.getByRole('button', { name: 'Abbrechen' }));
    await expectFocusAfterTab(user, applyButton);
    await user.keyboard('{Enter}');

    expect(onApply).toHaveBeenCalledWith(101, { freeAreaSqm: null });
  });

  it('supports reverse tab order with Shift+Tab', async () => {
    const user = userEvent.setup();
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={vi.fn()} />,
    );

    await openDialog();
    await expectCurrentFocus(screen.getByRole('combobox', { name: 'Standort' }));
    await expectFocusAfterTab(user, screen.getByRole('combobox', { name: 'Parzelle' }));
    const bedSelect = screen.getByRole('combobox', { name: 'Beet' });
    await expectFocusAfterTab(user, bedSelect);

    await waitFor(() => {
      expect(bedSelect).toHaveFocus();
    });
    pressShiftTab(bedSelect);
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Parzelle' })).toHaveFocus();
    });
    const fieldSelect = screen.getByRole('combobox', { name: 'Parzelle' });
    pressShiftTab(fieldSelect);
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Standort' })).toHaveFocus();
    });
  });

  describe('keyboard focus control', () => {
    it('keeps Tab inside the dialog instead of reaching the page behind it', async () => {
      const user = userEvent.setup();
      renderWithPageBackground();

      await openDialog();

      for (let step = 0; step < 8; step += 1) {
        await user.tab();
        expectFocusInsideDialog();
      }
    });

    it('hides the page behind the dialog from keyboard and assistive technology', async () => {
      renderWithPageBackground();

      await openDialog();

      // The page content is dropped from the accessibility tree entirely, so
      // it can only be found with `hidden: true`.
      expect(screen.queryByRole('button', { name: 'Tabellenzelle danach' })).not.toBeInTheDocument();
      const backgroundButton = screen.getByRole('button', { name: 'Tabellenzelle danach', hidden: true });
      expect(backgroundButton.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('keeps Shift+Tab inside the dialog instead of reaching the page behind it', async () => {
      const user = userEvent.setup();
      renderWithPageBackground();

      await openDialog();

      for (let step = 0; step < 8; step += 1) {
        await user.keyboard('{Shift>}{Tab}{/Shift}');
        expectFocusInsideDialog();
      }
    });

    it('marks the dialog as modal and labels it through its title', async () => {
      renderWithPageBackground();

      await openDialog();

      const dialog = getDialog();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy as string)).toHaveTextContent('Anbaufläche ändern');
    });

    it('takes over the highlighted option and moves to the next field on Tab', async () => {
      const user = userEvent.setup();
      renderWithPageBackground();

      await openDialog();
      await user.click(screen.getByRole('combobox', { name: 'Standort' }));
      await user.keyboard('{ArrowDown}');
      await user.tab();

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
      expect(screen.getByRole('combobox', { name: 'Standort' })).toHaveTextContent('Sonnengarten');
      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: 'Parzelle' })).toHaveFocus();
      });
    });

    it('moves to the previous field on Shift+Tab out of an open dropdown', async () => {
      const user = userEvent.setup();
      renderWithPageBackground();

      await openDialog();
      await user.click(screen.getByRole('combobox', { name: 'Beet' }));
      await user.keyboard('{Shift>}{Tab}{/Shift}');

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: 'Parzelle' })).toHaveFocus();
      });
    });

    it('never lands behind the dialog when tabbing out of any of the three dropdowns', async () => {
      const user = userEvent.setup();
      renderWithPageBackground();

      await openDialog();

      for (const label of ['Standort', 'Parzelle', 'Beet']) {
        await user.click(screen.getByRole('combobox', { name: label }));
        expect(await screen.findByRole('listbox')).toBeInTheDocument();
        await user.tab();
        await waitFor(() => {
          expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        });
        expectFocusInsideDialog();
      }
    });

    it('keeps arrow keys and Enter working inside an open dropdown', async () => {
      const user = userEvent.setup();
      renderWithPageBackground();

      await openDialog();
      await user.click(screen.getByRole('combobox', { name: 'Parzelle' }));
      await user.keyboard('{ArrowDown}{Enter}');

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
      expect(screen.getByRole('combobox', { name: 'Parzelle' })).toHaveTextContent('9 Pastinake');
      expectFocusInsideDialog();
    });

    it('closes only the dropdown on the first Escape and the dialog on the second', async () => {
      const user = userEvent.setup();
      renderWithPageBackground();

      await openDialog();
      await user.click(screen.getByRole('combobox', { name: 'Standort' }));
      expect(await screen.findByRole('listbox')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
      expect(getDialog()).toBeInTheDocument();

      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Anbaufläche ändern' })).not.toBeInTheDocument();
      });
    });

    it('returns focus to the opening cell trigger after Escape', async () => {
      const user = userEvent.setup();
      renderWithPageBackground({ hasFocus: true });

      await openDialog();
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Anbaufläche bearbeiten' })).toHaveFocus();
      });
    });

    it('stays inside the dialog when a Tab commit resets the downstream fields', async () => {
      const user = userEvent.setup();
      renderWithPageBackground();

      await openDialog();
      // Switching the location clears parcel and bed, so the bed select and the
      // apply button leave the tab order while focus is being moved.
      await user.click(screen.getByRole('combobox', { name: 'Standort' }));
      await user.keyboard('{ArrowDown}');
      await user.tab();

      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: 'Parzelle' })).toHaveFocus();
      });
      const bedSelect = screen.getByRole('combobox', { name: 'Beet' });
      expect(bedSelect).toHaveAttribute('aria-disabled', 'true');
      expect(within(bedSelect.closest('.MuiFormControl-root') as HTMLElement).getByText(
        'Bitte zuerst eine Parzelle auswählen.',
      )).toBeInTheDocument();

      const applyButton = screen.getByRole('button', { name: 'Übernehmen' });
      expect(applyButton).toBeDisabled();
      await user.hover(applyButton.parentElement as HTMLElement);
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Bitte zuerst ein Beet auswählen.');

      await user.tab();
      expectFocusInsideDialog();
      expect(screen.getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    });
  });

  it('keeps tab navigation working after confirming a dropdown option with Enter', async () => {
    const user = userEvent.setup();
    render(
      <AreaAssignmentDialog bedId={101} beds={beds} fields={fields} locations={locations} locale="de-DE" compactLabel="x" onApply={vi.fn()} />,
    );

    await openDialog();
    const locationSelect = screen.getByRole('combobox', { name: 'Standort' });
    await user.click(locationSelect);
    await user.keyboard('{ArrowDown}{Enter}');

    expect(screen.getByRole('combobox', { name: 'Standort' })).toHaveFocus();
    await expectFocusAfterTab(user, screen.getByRole('combobox', { name: 'Parzelle' }));
  });
});

describe('AreaAssignmentDialog with the crop rotation check', () => {
  const rotationBeds: Bed[] = [
    ...beds,
    { id: 103, name: '7', field: 11, field_name: '8 Karotte + Zwiebel', area_sqm: 10 },
    { id: 104, name: '8', field: 11, field_name: '8 Karotte + Zwiebel', area_sqm: 10 },
  ];

  const finding = (overrides: Partial<RotationFinding> = {}): RotationFinding => ({
    kind: 'ok',
    crop_label: 'Tomate',
    family_key: 'Solanaceae',
    // Stored English label; the UI shows the family in the UI language.
    family_name: 'Nightshade family',
    previous_plan_id: null,
    previous_crop_label: null,
    previous_family_key: null,
    previous_family_name: null,
    year: null,
    break_years: 3,
    earliest_year: null,
    break_source: 'family_default',
    settings_crop_id: 1,
    settings_crop_label: 'Tomate',
    ...overrides,
  });
  const conflictFinding = finding({
    kind: 'family_conflict',
    previous_plan_id: 7,
    previous_crop_label: 'Kartoffel',
    previous_family_key: 'Solanaceae',
    year: 2025,
    earliest_year: 2029,
  });

  const option = (bedId: number, overrides: Partial<BedSuggestion> = {}): BedSuggestion => {
    const bed = rotationBeds.find((item) => item.id === bedId) as Bed;
    const field = fields.find((item) => item.id === bed.field) as Field;
    const location = locations.find((item) => item.id === field.location) as Location;
    return {
      bed_id: bedId,
      bed_name: bed.name,
      field_id: field.id ?? null,
      field_name: field.name,
      location_id: location.id ?? null,
      location_name: location.name,
      category: 'good',
      status: 'ok',
      findings: [finding()],
      years_since_family: null,
      previous_is_soil_improver: false,
      bed_area_sqm: Number(bed.area_sqm),
      used_area_sqm: 0,
      free_area_sqm: Number(bed.area_sqm),
      has_enough_area: true,
      is_partially_occupied: false,
      blocking_plan: null,
      ...overrides,
    };
  };

  // The backend's order: ok, hint, conflict, then beds without room.
  const results = [
    option(201),
    option(104, { used_area_sqm: 4, free_area_sqm: 6, is_partially_occupied: true }),
    option(102, {
      category: 'hint',
      status: 'hint',
      findings: [finding({ kind: 'nutrient_hint', previous_crop_label: 'Kohl', year: 2025 })],
    }),
    option(101, { category: 'conflict', status: 'conflict', findings: [conflictFinding] }),
    option(103, {
      used_area_sqm: 8,
      free_area_sqm: 2,
      has_enough_area: false,
      is_partially_occupied: true,
      blocking_plan: { plan_id: 9, crop_label: 'Karotte', end_date: '2026-06-15' },
    }),
  ];

  const rotation = (overrides: Partial<AreaAssignmentRotationContext> = {}): AreaAssignmentRotationContext => ({
    cropId: 1,
    plantingDate: '2026-04-01',
    endDate: '2026-07-20',
    areaSqm: 5,
    planId: 50,
    cultureLabel: 'Tomate',
    status: 'conflict',
    findings: [conflictFinding],
    acceptance: null,
    ...overrides,
  });

  const renderDialog = (context: AreaAssignmentRotationContext, onApply = vi.fn()) => {
    render(
      <MemoryRouter>
      <AreaAssignmentDialog
        bedId={101}
        beds={rotationBeds}
        fields={fields}
        locations={locations}
        locale="de-DE"
        compactLabel="Regenbogenland | 8 Karotte + Zwiebel | 5"
        onApply={onApply}
        rotation={context}
      />
      </MemoryRouter>,
    );
    return onApply;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetPlantFamiliesCache();
    apiMocks.plantFamilies.mockResolvedValue({
      data: [{
        botanical_name: 'Solanaceae',
        display_name: 'Nightshade family',
        translations: { de: 'Nachtschattengewächse', en: 'Nightshade family' },
        default_rotation_break_years: 3,
      }],
    });
    apiMocks.bedSuggestions.mockResolvedValue({
      data: {
        count: results.length,
        available_count: 4,
        start_date: '2026-04-01',
        end_date: '2026-07-20',
        results,
      },
    });
    apiMocks.rotationCheck.mockImplementation(async ({ bed_id }: { bed_id: number }) => ({
      data: bed_id === 101
        ? { status: 'conflict', findings: [conflictFinding], bed_history: [] }
        : { status: 'ok', findings: [finding({ year: 2021 })], bed_history: [] },
    }));
  });

  it('flags the conflict in the cell and opens the same dialog from the icon', async () => {
    const user = userEvent.setup();
    renderDialog(rotation());

    await user.click(screen.getByRole('button', { name: 'Fruchtfolge-Konflikt, Anbaufläche ändern' }));

    expect(await screen.findByRole('dialog', { name: 'Anbaufläche ändern' })).toBeInTheDocument();
    expect(await screen.findByText('Fruchtfolge: Nachtschattengewächse zu früh auf diesem Beet')).toBeInTheDocument();
  });

  it('shows no status in the cell when nothing is left to do', () => {
    for (const status of ['ok', 'accepted', 'hint'] as const) {
      const { unmount } = render(
        <MemoryRouter>
          <AreaAssignmentDialog
            bedId={101}
            beds={rotationBeds}
            fields={fields}
            locations={locations}
            locale="de-DE"
            compactLabel="x"
            onApply={vi.fn()}
            rotation={rotation({ status, findings: [finding({ year: 2021 })] })}
          />
        </MemoryRouter>,
      );
      expect(screen.queryByTestId('rotation-status-button')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('flags missing culture data in the cell', () => {
    renderDialog(rotation({ status: 'info', findings: [finding({ kind: 'no_family' })] }));

    expect(screen.getByRole('button', { name: 'Fruchtfolge nicht prüfbar, Anbaufläche ändern' })).toBeInTheDocument();
  });

  it('names every missing value in the "not checkable" tooltip', async () => {
    const user = userEvent.setup();
    const previousWithoutFamily = (label: string, year: number, planId: number): RotationFinding => finding({
      kind: 'previous_no_family',
      crop_label: null,
      family_key: null,
      family_name: null,
      previous_plan_id: planId,
      previous_crop_label: label,
      year,
      break_years: null,
      break_source: null,
    });
    const cases: Array<{ findings: RotationFinding[]; reasons: string[] }> = [
      {
        findings: [finding({ kind: 'no_family', crop_label: 'Erdbeere (Mieze)', family_key: null })],
        reasons: ['Für Erdbeere (Mieze) ist keine Pflanzenfamilie hinterlegt.'],
      },
      {
        findings: [finding({ kind: 'no_break', crop_label: 'Mais', break_years: null })],
        reasons: ['Für Mais ist keine Anbaupause hinterlegt.'],
      },
      {
        findings: [previousWithoutFamily('Rhabarber', 2025, 7)],
        reasons: ['Für die Vorkultur Rhabarber (2025) ist keine Pflanzenfamilie hinterlegt.'],
      },
      {
        findings: [
          finding({ kind: 'no_family', crop_label: 'Erdbeere', family_key: null }),
          previousWithoutFamily('Rhabarber', 2024, 7),
          previousWithoutFamily('Topinambur', 2025, 8),
        ],
        reasons: [
          'Für Erdbeere ist keine Pflanzenfamilie hinterlegt.',
          'Für die Vorkultur Rhabarber (2024) ist keine Pflanzenfamilie hinterlegt.',
          'Für die Vorkultur Topinambur (2025) ist keine Pflanzenfamilie hinterlegt.',
        ],
      },
    ];

    for (const { findings, reasons } of cases) {
      const { unmount } = render(
        <MemoryRouter>
          <AreaAssignmentDialog
            bedId={101}
            beds={rotationBeds}
            fields={fields}
            locations={locations}
            locale="de-DE"
            compactLabel="x"
            onApply={vi.fn()}
            rotation={rotation({ status: 'info', findings })}
          />
        </MemoryRouter>,
      );
      await user.hover(screen.getByTestId('rotation-status-button'));
      const tooltip = await screen.findByRole('tooltip');
      const lines = Array.from(tooltip.querySelectorAll('span')).map((line) => line.textContent);
      expect(lines).toEqual([
        'Fruchtfolge nicht prüfbar:',
        ...reasons,
        'Du kannst die fehlenden Angaben in der Kulturbibliothek ergänzen.',
      ]);
      await user.unhover(screen.getByTestId('rotation-status-button'));
      unmount();
    }
  });

  it('shows no status in the cell for a draft that cannot be checked yet', () => {
    renderDialog(rotation({ status: 'info', findings: [finding({ kind: 'incomplete' })] }));

    expect(screen.queryByTestId('rotation-status-button')).not.toBeInTheDocument();
  });

  it('suggests matching beds across locations and fills the selects without saving', async () => {
    const user = userEvent.setup();
    const onApply = renderDialog(rotation());
    await openDialog();

    // Expanded by default, because the current bed has a conflict.
    expect(await screen.findByText('Passende Beete, frei von 01.04.2026 bis 20.07.2026')).toBeInTheDocument();
    expect(apiMocks.bedSuggestions).toHaveBeenCalledWith({
      crop_id: 1,
      planting_date: '2026-04-01',
      end_date: '2026-07-20',
      exclude_plan_id: 50,
      area_sqm: 5,
    });
    const rows = await screen.findAllByTestId('bed-suggestion');
    // Top three of the beds with room and without a conflict.
    expect(rows.map((row) => row.getAttribute('data-bed-id'))).toEqual(['201', '104', '102']);
    expect(within(rows[0]).getByText('Sonnengarten | 5 Tomate | 5')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Keine Nachtschattengewächse erfasst')).toBeInTheDocument();

    await user.click(rows[0]);

    // Picking a bed in another location loads that location's fields first,
    // so the field and bed selects fill a moment after the click.
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Standort' })).toHaveTextContent('Sonnengarten');
      expect(screen.getByRole('combobox', { name: 'Parzelle' })).toHaveTextContent('5 Tomate');
      expect(screen.getByRole('combobox', { name: 'Beet' })).toHaveTextContent('5 (12,50 m²)');
    });
    // The family's localized name arrives with the plant-family list, which
    // may load after the check result.
    await waitFor(() => expect(screen.getByTestId('rotation-check-ok')).toHaveTextContent(
      'Fruchtfolge passt: letzte Nachtschattengewächse 2021.',
    ));
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onApply).toHaveBeenCalledWith(201, { freeAreaSqm: 12.5 });
  });

  it('orders the bed options and disables beds without enough free area', async () => {
    renderDialog(rotation({ status: null, findings: null }));
    await openDialog();
    await waitFor(() => expect(apiMocks.bedSuggestions).toHaveBeenCalled());
    // Collapsed without a conflict.
    expect(screen.queryByTestId('area-bed-suggestions')).not.toBeInTheDocument();

    await openSelect('Beet');
    const options = await screen.findAllByTestId('bed-option');
    expect(options.map((item) => item.getAttribute('data-value'))).toEqual(['104', '101', '103']);
    expect(options[0]).toHaveTextContent('Keine Nachtschattengewächse erfasst · 6 von 10 m² frei im Zeitraum');
    expect(options[1]).toHaveAttribute('data-rotation-status', 'conflict');
    expect(options[2]).toHaveAttribute('aria-disabled', 'true');
    expect(options[2]).toHaveTextContent(
      'Nur 2 m² frei im Zeitraum (Karotte bis 15.06.2026), benötigt 5 m²',
    );
  });

  it('accepts the conflict for the chosen bed on "Übernehmen"', async () => {
    const user = userEvent.setup();
    const onApply = renderDialog(rotation());
    await openDialog();

    await user.click(await screen.findByRole('checkbox', { name: 'Bewusst so planen (Konflikt akzeptieren)' }));
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));

    expect(onApply).toHaveBeenCalledWith(101, { rotationConflictAccepted: true, freeAreaSqm: 10 });
  });

  it('withdraws a stored acceptance', async () => {
    const user = userEvent.setup();
    const onApply = renderDialog(rotation({
      status: 'accepted',
      acceptance: {
        rotation_conflict_accepted: true,
        rotation_conflict_accepted_at: '2026-03-01T10:00:00Z',
        rotation_conflict_accepted_by_user: { id: 1, email: 'a@example.com', display_name: 'Anna', display_label: 'Anna' },
      },
    }));

    // Accepted conflicts show no icon in the table, only in the dialog.
    expect(screen.queryByTestId('rotation-status-button')).not.toBeInTheDocument();
    await openDialog();
    expect(await screen.findByTestId('rotation-check-accepted')).toHaveTextContent('Akzeptiert von Anna');
    await user.click(screen.getByRole('button', { name: 'Akzeptieren zurücknehmen' }));
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));

    expect(onApply).toHaveBeenCalledWith(101, { rotationConflictAccepted: false, freeAreaSqm: 10 });
  });
});
