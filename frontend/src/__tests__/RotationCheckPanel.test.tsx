import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RotationCheckResponse, RotationFinding } from '../api/types';
import { RotationCheckPanel } from '../components/planting-plans/rotation/RotationCheckPanel';

const { rotationCheckMock } = vi.hoisted(() => ({ rotationCheckMock: vi.fn() }));
vi.mock('../api/api', () => ({ plantingPlanAPI: { rotationCheck: rotationCheckMock } }));

const conflictFinding: RotationFinding = {
  kind: 'family_conflict',
  crop_label: 'Brokkoli',
  family_key: 'Brassicaceae',
  family_name: 'Kreuzblütler',
  previous_plan_id: 7,
  previous_crop_label: 'Grünkohl',
  previous_family_name: 'Kreuzblütler',
  year: 2025,
  break_years: 4,
  earliest_year: 2030,
  break_source: 'family_default',
  settings_crop_id: 12,
  settings_crop_label: 'Brokkoli',
};

const respond = (data: Partial<RotationCheckResponse>): void => {
  rotationCheckMock.mockResolvedValue({
    data: { status: 'ok', findings: [], bed_history: [], ...data },
  });
};

const input = { cropId: 12, bedId: 3, plantingDate: '2026-04-01', planId: null };

const renderPanel = (props: Partial<Parameters<typeof RotationCheckPanel>[0]> = {}) => render(
  <MemoryRouter>
    <RotationCheckPanel input={input} bedLabel="Beet 3" cultureLabel="Brokkoli" {...props} />
  </MemoryRouter>,
);

describe('RotationCheckPanel', () => {
  beforeEach(() => {
    rotationCheckMock.mockReset();
  });

  it('renders nothing until crop, bed and planting date are known', () => {
    renderPanel({ input: { ...input, bedId: null } });

    expect(rotationCheckMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Fruchtfolge wird geprüft …')).not.toBeInTheDocument();
  });

  it('explains a conflict from the family default and offers acceptance', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    respond({
      status: 'conflict',
      findings: [conflictFinding],
      bed_history: [{ plan_id: 7, crop_label: 'Grünkohl', family_name: 'Kreuzblütler', first_year: 2025, last_year: 2025 }],
    });

    renderPanel({ acceptance: { accepted: false, persisted: null, onChange } });

    expect(await screen.findByText('Fruchtfolge: Kreuzblütler zu früh auf diesem Beet')).toBeInTheDocument();
    expect(screen.getByText(
      'Auf Beet 3 stand 2025 Grünkohl (Kreuzblütler). Für Kreuzblütler sind standardmäßig 4 Jahre Anbaupause hinterlegt, also frühestens wieder 2030.',
      { exact: false },
    )).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anbaupause bei Brokkoli festlegen' })).toHaveAttribute(
      'href',
      '/app/crops?cropId=12&action=edit',
    );
    expect(screen.getByText(
      'Gespeichert werden kann trotzdem. Akzeptierte Konflikte bleiben in der Tabelle als solche markiert.',
    )).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Belegung von Beet 3 ansehen' }));
    expect(screen.getByText('2025: Grünkohl (Kreuzblütler)')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Bewusst so planen (Konflikt akzeptieren)'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('names the culture when the break is its own', async () => {
    respond({ status: 'conflict', findings: [{ ...conflictFinding, break_source: 'crop', break_years: 1, earliest_year: 2027 }] });

    renderPanel();

    expect(await screen.findByText(
      'Bei Brokkoli ist 1 Jahr Anbaupause hinterlegt, also frühestens wieder 2027.',
      { exact: false },
    )).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anbaupause bei Brokkoli ändern' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Bewusst so planen (Konflikt akzeptieren)')).not.toBeInTheDocument();
  });

  it('shows a stored acceptance with who and when, and lets it be withdrawn', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    respond({ status: 'conflict', findings: [conflictFinding] });

    renderPanel({
      acceptance: {
        accepted: true,
        persisted: { userLabel: 'Alex', acceptedAt: '2026-03-02T10:00:00Z' },
        onChange,
      },
    });

    expect(await screen.findByText('Kreuzblütler zu früh, bewusst akzeptiert')).toBeInTheDocument();
    expect(screen.getByText(/Grünkohl 2025 auf diesem Beet\. Akzeptiert von Alex am/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Akzeptieren zurücknehmen' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('shows the nutrient hint', async () => {
    respond({
      status: 'hint',
      findings: [{ ...conflictFinding, kind: 'nutrient_hint', previous_crop_label: 'Tomate', year: 2025 }],
    });

    renderPanel();

    expect(await screen.findByText('Starkzehrer nach Starkzehrer')).toBeInTheDocument();
    expect(screen.getByText(
      '2025 stand hier Tomate. Plane ausreichend Kompost oder eine Gründüngung dazwischen ein.',
      { exact: false },
    )).toBeInTheDocument();
  });

  it('keeps "not checkable" apart from "fits"', async () => {
    respond({ status: 'info', findings: [{ ...conflictFinding, kind: 'no_family', family_name: null }] });

    renderPanel();

    expect(await screen.findByText('Fruchtfolge nicht prüfbar')).toBeInTheDocument();
    expect(screen.getByText(
      'Bei Brokkoli ist keine Pflanzenfamilie hinterlegt. Ohne Familie können wir keine Anbaupause prüfen.',
      { exact: false },
    )).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Familie bei Brokkoli ergänzen' })).toBeInTheDocument();
  });

  it('shows a one-line success note when the rotation fits', async () => {
    respond({
      status: 'ok',
      findings: [{ ...conflictFinding, kind: 'ok', year: 2020, previous_crop_label: 'Karotte' }],
    });

    renderPanel();

    expect(await screen.findByText('Fruchtfolge passt: letzte Kreuzblütler 2020, Vorkultur Karotte.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats a bed without earlier plans as fitting', async () => {
    respond({ status: 'ok', findings: [{ ...conflictFinding, kind: 'no_history', year: null }] });

    renderPanel();

    expect(await screen.findByText('Fruchtfolge passt: auf diesem Beet sind keine früheren Anbaupläne erfasst.')).toBeInTheDocument();
    expect(screen.queryByTestId('rotation-check-info')).not.toBeInTheDocument();
  });
});
