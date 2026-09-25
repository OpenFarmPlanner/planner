import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { UnlinkPublicCropDialog } from '../crops/UnlinkPublicCropDialog';
import type { Crop } from '../api/types';

const { publicCropGetMock } = vi.hoisted(() => ({ publicCropGetMock: vi.fn() }));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return { ...actual, publicCropAPI: { ...actual.publicCropAPI, get: publicCropGetMock } };
});

const CROP: Crop = { id: 1, name: 'Lauch', variety: '', source_public_crop: 9, origin_type: 'imported' };

const renderDialog = (hasLinkedVarieties: boolean, handlers = { onCancel: vi.fn(), onConfirm: vi.fn() }) => render(
  <UnlinkPublicCropDialog open crop={CROP} hasLinkedVarieties={hasLinkedVarieties} {...handlers} />,
);

describe('UnlinkPublicCropDialog', () => {
  beforeEach(() => {
    publicCropGetMock.mockReset();
    publicCropGetMock.mockResolvedValue({
      data: { id: 9, name: 'Porree', display_name: 'Porree', variety: '', status: 'published', version: 2 },
    });
  });

  it('names both sides and lists what stays, without the Sorten line when there are none', async () => {
    renderDialog(false);

    expect(screen.getByText('Verknüpfung aufheben?')).toBeInTheDocument();
    expect(await screen.findByText(/Deine Kultur „Lauch“ wird vom öffentlichen Eintrag „Porree“ getrennt\./)).toBeInTheDocument();
    const items = within(screen.getByTestId('unlink-public-crop-bullets')).getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items).toEqual([
      'Deine aktuellen Werte bleiben unverändert.',
      'Werte, die du bereits in der Kulturbibliothek aktualisiert hast, bleiben dort erhalten.',
      'Du kannst die Kultur später erneut verknüpfen.',
    ]);
  });

  it('mentions linked Sorten only when the Kultur has some', () => {
    renderDialog(true);

    expect(screen.getByText('Verknüpfte Sorten bleiben verknüpft.')).toBeInTheDocument();
  });

  it('confirms with the warning-coloured primary button and cancels with "Abbrechen"', () => {
    const handlers = { onCancel: vi.fn(), onConfirm: vi.fn() };
    renderDialog(false, handlers);

    fireEvent.click(screen.getByRole('button', { name: 'Verknüpfung aufheben' }));
    expect(handlers.onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(handlers.onCancel).toHaveBeenCalled();
  });
});
