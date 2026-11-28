import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeometryChangePreview, GeometryPreviewRequired } from '../../../api/types';
import { AreaRetirementDialog } from '../geometryChange/AreaRetirementDialog';
import { GeometryChangeDialog } from '../geometryChange/GeometryChangeDialog';
import {
  geometryPreviewRequest,
  registerAreaRetirementHandler,
  registerGeometryChangeHandler,
  requestGeometryChange,
  retireInsteadOfDelete,
} from '../geometryChange/geometryChangeBridge';

const { previewMock, confirmMock } = vi.hoisted(() => ({ previewMock: vi.fn(), confirmMock: vi.fn() }));
vi.mock('../../../api/api', () => ({
  growingAreaGeometryAPI: { preview: previewMock, confirm: confirmMock },
}));

const facts = (width: number) => ({
  length_m: 10, width_m: width, area_sqm: 10 * width, measurement_basis: 'dimensions' as const,
  parent_id: 3,
});

const request: GeometryPreviewRequired = {
  code: 'geometry_preview_required', kind: 'bed', id: 42, name: 'Beet 42',
  version_id: 7, revision: 1, version_effective_from: '2025-10-01',
  season: 9, season_start: '2026-10-01', season_label: '26/27',
  previous: facts(1), proposed: facts(1.5),
};

function preview(overrides: Partial<GeometryChangePreview> = {}): GeometryChangePreview {
  return {
    kind: 'bed', id: 42, name: 'Beet 42', action: 'physical_change',
    effective_from: '2026-10-01', interval_end: null,
    target_version: { id: 7, revision: 1, effective_from: '2025-10-01', origin: 'legacy_observation' },
    continues_after: null, previous: facts(1), proposed: facts(1.5),
    affected_plans: { count: 1, results: [{ id: 5, label: 'Salat / Beet 42', start: '2026-09-25', end: '2026-10-15' }] },
    descendant_count: 0, conflicts: [], warnings: [], can_confirm: true, token: 'signed', ...overrides,
  };
}

describe('GeometryChangeDialog', () => {
  beforeEach(() => {
    previewMock.mockReset();
    confirmMock.mockReset();
  });

  it('previews a physical change from the selected season and confirms it', async () => {
    previewMock.mockResolvedValue({ data: preview() });
    confirmMock.mockResolvedValue({ data: {} });
    const onDone = vi.fn();
    render(<GeometryChangeDialog request={request} onDone={onDone} />);

    expect(await screen.findByText('Salat / Beet 42')).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'physical_change', season: 9, width_m: 1.5, parent_id: 3,
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Maße speichern' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(confirmMock).toHaveBeenCalledWith('signed', expect.any(String));
  });

  it('shows blocking conflicts and keeps the confirmation disabled', async () => {
    previewMock.mockResolvedValue({ data: preview({
      can_confirm: false, token: null,
      conflicts: [{ code: 'geometry_capacity_exceeded', used_area_sqm: 12, area_sqm: 10 }],
    }) });
    render(<GeometryChangeDialog request={request} onDone={vi.fn()} />);
    expect(await screen.findByText(/bis zu 12 m²/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maße speichern' })).toBeDisabled();
  });

  it('switches to a correction of the recorded version', async () => {
    previewMock.mockResolvedValue({ data: preview({ action: 'correction' }) });
    render(<GeometryChangeDialog request={request} onDone={vi.fn()} />);
    await screen.findByText('Salat / Beet 42');
    await userEvent.click(screen.getByRole('radio', { name: /Maße korrigieren/ }));
    await waitFor(() => expect(previewMock).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'correction', version_id: 7, revision: 1,
    })));
  });

  it('offers only a correction when the season starts before the recorded version', async () => {
    previewMock.mockResolvedValue({ data: preview({ action: 'correction' }) });
    render(<GeometryChangeDialog request={{ ...request, season_start: '2025-01-01' }} onDone={vi.fn()} />);
    await screen.findByText('Salat / Beet 42');
    expect(screen.getByRole('radio', { name: /Physische Änderung/ })).toBeDisabled();
    expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'correction' }));
  });
});

describe('geometryChangeBridge', () => {
  it('recognizes the conflict and hands it to the registered handler', async () => {
    const error = new AxiosError('Conflict', '409', undefined, undefined, {
      status: 409, statusText: 'Conflict', data: request, headers: {},
      config: { headers: new AxiosHeaders() },
    });
    expect(geometryPreviewRequest(error)).toEqual(request);
    expect(geometryPreviewRequest(new Error('other'))).toBeNull();
    expect(await requestGeometryChange(request)).toBe(false);
    const unregister = registerGeometryChangeHandler(async () => true);
    expect(await requestGeometryChange(request)).toBe(true);
    unregister();
    expect(await requestGeometryChange(request)).toBe(false);
  });
});

describe('AreaRetirementDialog', () => {
  const inUse = {
    code: 'area_in_use' as const, kind: 'bed' as const, id: 42, name: 'Beet 42',
    version_id: 7, revision: 1, version_effective_from: '2025-10-01',
    season: 9, season_start: '2026-10-01', season_label: '26/27',
  };

  beforeEach(() => {
    previewMock.mockReset();
    confirmMock.mockReset();
  });

  it('previews and confirms a retirement from the selected season', async () => {
    previewMock.mockResolvedValue({ data: preview({ action: 'retirement', descendant_count: 0 }) });
    confirmMock.mockResolvedValue({ data: {} });
    const onDone = vi.fn();
    render(<AreaRetirementDialog request={inUse} onDone={onDone} />);
    expect(await screen.findByText(/Stilllegen ab Saison 26\/27/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stilllegen' })).toBeEnabled());
    expect(previewMock).toHaveBeenCalledWith({ kind: 'bed', id: 42, action: 'retirement', season: 9 });
    await userEvent.click(screen.getByRole('button', { name: 'Stilllegen' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
  });

  it('explains plans that block the retirement', async () => {
    previewMock.mockResolvedValue({ data: preview({
      action: 'retirement', can_confirm: false, token: null,
      conflicts: [{ code: 'geometry_retirement_plans', count: 2 }],
    }) });
    render(<AreaRetirementDialog request={inUse} onDone={vi.fn()} />);
    expect(await screen.findByText(/2 Anbaupläne reichen in diese Saison/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stilllegen' })).toBeDisabled();
  });

  it('offers retirement only for a refused deletion of a used area', async () => {
    const refused = new AxiosError('Conflict', '409', undefined, undefined, {
      status: 409, statusText: 'Conflict', data: inUse, headers: {},
      config: { headers: new AxiosHeaders() },
    });
    expect(await retireInsteadOfDelete(new Error('other'))).toBeNull();
    expect(await retireInsteadOfDelete(refused)).toBe(false);
    const unregister = registerAreaRetirementHandler(async () => true);
    expect(await retireInsteadOfDelete(refused)).toBe(true);
    unregister();
  });
});
