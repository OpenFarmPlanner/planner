import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CropBulkDeletionDialog } from '../crops/CropBulkDeletionDialog';
import i18n from '../i18n';
import type { CropBulkDeletePreview } from '../api/types';

const api = vi.hoisted(() => ({ bulkDeletePreview: vi.fn(), bulkDelete: vi.fn() }));
vi.mock('../api/api', () => ({ cropAPI: api }));

const t = i18n.getFixedT('de', 'crops');
const preview: CropBulkDeletePreview = {
  scope: 'selected',
  selected_count: 1,
  affected_count: 1,
  variety_count: 0,
  general_count: 1,
  additional_count: 0,
  missing_count: 0,
  blocked_count: 0,
  planting_plan_count: 0,
  seed_package_count: 0,
  supplier_offer_count: 0,
  samples: [{ id: 10, name: 'Chard' }],
  blockers: [],
  token: 'preview-token',
};

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('de');
});

it('retries an unacknowledged deletion with the same request and preview', async () => {
  api.bulkDeletePreview.mockResolvedValue({ data: preview });
  api.bulkDelete.mockRejectedValueOnce(new Error('Response unavailable'));
  const result = { batch_id: 12, deleted_count: 1, blocked_count: 0, skipped_count: 0, failed_count: 0 };
  api.bulkDelete.mockResolvedValueOnce({ data: result });
  const onComplete = vi.fn();
  const user = userEvent.setup();
  render(<CropBulkDeletionDialog target={{ scope: 'selected', expected_project_id: 7, crop_ids: [10] }}
    onClose={vi.fn()} onComplete={onComplete} />);

  const confirm = screen.getByRole('button', { name: t('bulkDelete.confirm') });
  expect(confirm).toBeDisabled();
  await screen.findByText(t('bulkDelete.counts.affected'));
  expect(api.bulkDeletePreview).toHaveBeenCalledWith({
    scope: 'selected', expected_project_id: 7, crop_ids: [10], delete_varieties: false,
  }, expect.any(AbortSignal));
  await user.click(confirm);

  expect(await screen.findByRole('alert')).toHaveTextContent(t('bulkDelete.outcomeUnknown'));
  expect(onComplete).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox', { name: t('bulkDelete.deleteVarieties') })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: t('bulkDelete.retry') }));
  expect(api.bulkDelete.mock.calls[0][0]).toMatchObject({ crop_ids: [10], delete_varieties: false });
  expect(api.bulkDelete.mock.calls[1]).toEqual(api.bulkDelete.mock.calls[0]);
  expect(onComplete).toHaveBeenCalledOnce();
  expect(onComplete).toHaveBeenCalledWith(result);
});
