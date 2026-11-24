import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CropBulkDeletionDialog } from '../crops/CropBulkDeletionDialog';
import i18n from '../i18n';
import type { CropBulkDeletePreview, CropBulkDeleteRecord } from '../api/types';

const api = vi.hoisted(() => ({ bulkDeletePreview: vi.fn(), bulkDelete: vi.fn() }));
vi.mock('../api/api', () => ({ cropAPI: api }));

const t = i18n.getFixedT('de', 'crops');
const chard = { id: 10, name: 'Other chard', variety: null, parent_id: null, parent_name: 'Other chard' };
const tomato = { id: 11, name: 'Manual tomato', variety: null, parent_id: null, parent_name: 'Manual tomato' };
const variety = { id: 12, name: 'Manual tomato', variety: 'File chard', parent_id: 11, parent_name: 'Manual tomato' };
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
  samples: [chard],
  affected_records: [chard],
  required_varieties: [],
  blockers: [],
  token: 'preview-token',
};

function renderDialog(cropIds: number[], canRestoreFromHistory = true) {
  const onComplete = vi.fn();
  render(<CropBulkDeletionDialog target={{ scope: 'selected', expected_project_id: 7, crop_ids: cropIds }}
    canRestoreFromHistory={canRestoreFromHistory} onClose={vi.fn()} onComplete={onComplete} />);
  return onComplete;
}

function makePreview(records: CropBulkDeleteRecord[], overrides: Partial<CropBulkDeletePreview> = {}) {
  const count = records.filter(record => record.variety).length;
  return {
    ...preview, selected_count: records.length, affected_count: records.length,
    general_count: records.length - count, variety_count: count, affected_records: records,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('de');
});

it('retries an unacknowledged deletion with the same request and preview', async () => {
  api.bulkDeletePreview.mockResolvedValue({ data: preview });
  api.bulkDelete.mockRejectedValueOnce(new Error('Response unavailable'));
  const result = { batch_id: 12, deleted_count: 1, blocked_count: 0, skipped_count: 0, failed_count: 0 };
  api.bulkDelete.mockResolvedValueOnce({ data: result });
  const user = userEvent.setup();
  const onComplete = renderDialog([10]);

  const confirm = screen.getByRole('button', { name: t('bulkDelete.confirm') });
  expect(confirm).toBeDisabled();
  await screen.findByRole('heading', { name: '1 Kultur löschen?' });
  expect(api.bulkDeletePreview).toHaveBeenCalledWith({
    scope: 'selected', expected_project_id: 7, crop_ids: [10], delete_varieties: false,
  }, expect.any(AbortSignal));
  await user.click(confirm);

  expect(await screen.findByRole('alert')).toHaveTextContent(t('bulkDelete.outcomeUnknown'));
  expect(onComplete).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t('bulkDelete.retry') }));
  expect(api.bulkDelete.mock.calls[0][0]).toMatchObject({ crop_ids: [10], delete_varieties: false });
  expect(api.bulkDelete.mock.calls[1]).toEqual(api.bulkDelete.mock.calls[0]);
  expect(onComplete).toHaveBeenCalledOnce();
  expect(onComplete).toHaveBeenCalledWith(result);
});

it('names an unrelated culture and variety directly and offers the appropriate recovery notice', async () => {
  api.bulkDeletePreview.mockResolvedValue({ data: makePreview([chard, variety]) });
  renderDialog([10, 12], false);
  const dialog = await screen.findByRole('dialog', { name: '1 Kultur und 1 Sorte löschen?' });
  expect(dialog).toHaveTextContent('Other chard');
  expect(dialog).toHaveTextContent('Manual tomato (File chard)');
  expect(dialog).toHaveTextContent(t('bulkDelete.recoveryUndo'));
  expect(dialog).toHaveTextContent(t('bulkDelete.libraryNotice'));
  expect(dialog).not.toHaveTextContent(t('bulkDelete.recoveryHistory'));
  expect(dialog).not.toHaveTextContent(t('bulkDelete.retainedData'));
  expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
});

it('nests named varieties under an affected parent and expands the complete list', async () => {
  const records = [tomato, ...Array.from({ length: 10 }, (_, index) => ({
    ...variety, id: index + 12, variety: `Variety ${index + 1}`,
  }))];
  api.bulkDeletePreview.mockResolvedValue({ data: makePreview(records, { seed_package_count: 1 }) });
  renderDialog(records.map(record => record.id));
  await screen.findByRole('heading', { name: '1 Kultur und 10 Sorten löschen?' });
  const list = screen.getByRole('list', { name: t('bulkDelete.affectedList') });
  expect(within(list).getAllByRole('listitem')).toHaveLength(8);
  expect(within(list).getByRole('list')).toHaveTextContent('Variety 1');
  expect(screen.getByText('1 Saatgutpackung')).toBeVisible();
  const user = userEvent.setup();
  const toggle = screen.getByRole('button', { name: '3 weitere Einträge anzeigen' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(within(list).getAllByRole('listitem')).toHaveLength(11);
  expect(within(list).getByText('Variety 10')).toBeVisible();
  await user.click(toggle);
  expect(within(list).queryByText('Variety 10')).not.toBeInTheDocument();
});

const scopeNeedsVariety = makePreview([tomato], {
  required_varieties: [variety],
  blockers: [{ code: 'varieties_required', count: 1, samples: [tomato] }],
  blocked_count: 1, token: null,
});

it('requires explicit consent for additional varieties and confirms the original IDs with the fresh token', async () => {
  api.bulkDeletePreview.mockResolvedValueOnce({ data: scopeNeedsVariety });
  api.bulkDeletePreview.mockResolvedValueOnce({ data: makePreview([tomato, variety], {
    selected_count: 1, additional_count: 1, token: 'expanded-token',
  }) });
  api.bulkDelete.mockResolvedValueOnce({ data: { batch_id: 1, deleted_count: 2 } });
  renderDialog([11]);
  const required = await screen.findByRole('list', { name: t('bulkDelete.requiredList') });
  expect(required).toHaveTextContent('Manual tomato (File chard)');
  const confirm = screen.getByRole('button', { name: t('bulkDelete.confirm') });
  expect(confirm).toBeDisabled();
  const user = userEvent.setup();
  const optIn = screen.getByRole('checkbox', { name: t('bulkDelete.deleteVarieties') });
  expect(optIn).not.toBeChecked();
  await user.click(optIn);
  await screen.findByRole('heading', { name: '1 Kultur und 1 Sorte löschen?' });
  expect(optIn).toBeChecked();
  expect(screen.getByRole('list', { name: t('bulkDelete.affectedList') })).toHaveTextContent('File chard');
  await user.click(confirm);
  expect(api.bulkDelete).toHaveBeenCalledWith(expect.objectContaining({
    crop_ids: [11], delete_varieties: true, preview_token: 'expanded-token', confirm_all: false,
  }));
});

it('blocks a new additional variety until a fresh preview and explicit opt-in', async () => {
  api.bulkDeletePreview.mockResolvedValueOnce({ data: scopeNeedsVariety });
  api.bulkDeletePreview.mockResolvedValueOnce({ data: makePreview([tomato, { ...variety, id: 19 }]) });
  api.bulkDeletePreview.mockResolvedValueOnce({ data: scopeNeedsVariety });
  renderDialog([11]);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('checkbox', { name: t('bulkDelete.deleteVarieties') }));
  expect(await screen.findByRole('alert')).toHaveTextContent(t('bulkDelete.errors.changed'));
  expect(screen.getByRole('button', { name: t('bulkDelete.confirm') })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: t('restoreDialog.preview.refresh') }));
  expect(await screen.findByRole('checkbox', { name: t('bulkDelete.deleteVarieties') })).not.toBeChecked();
  expect(api.bulkDelete).not.toHaveBeenCalled();
});

it('explains nonzero planting plans, missing records and retained dependency data', async () => {
  api.bulkDeletePreview.mockResolvedValue({ data: makePreview([chard], {
    missing_count: 1, planting_plan_count: 2, supplier_offer_count: 3, blocked_count: 1, token: null,
    blockers: [{ code: 'planting_plans', count: 1, samples: [chard] }],
  }) });
  renderDialog([10, 15]);
  expect(await screen.findByText(t('bulkDelete.plantingPlans', { count: 2 }))).toBeVisible();
  expect(screen.getByText(t('bulkDelete.missing'))).toBeVisible();
  expect(screen.getByText('3 Lieferantenangebote')).toBeVisible();
  expect(screen.getByRole('button', { name: t('bulkDelete.confirm') })).toBeDisabled();
  expect(screen.getByRole('button', { name: t('restoreDialog.preview.refresh') })).toBeEnabled();
});

it.each([
  ['de', '1 Kultur und 2 Sorten löschen?'],
  ['en', 'Delete 1 crop and 2 varieties?'],
  ['fr', 'Supprimer 1 culture et 2 variétés\u202f?'],
  ['es', '¿Eliminar 1 cultivo y 2 variedades?'],
  ['it', 'Eliminare 1 coltura e 2 varietà?'],
  ['pt', 'Eliminar 1 cultura e 2 variedades?'],
  ['nl', '1 gewas en 2 rassen verwijderen?'],
])('localizes the mixed-scope question in %s', async (language, question) => {
  await i18n.changeLanguage(language);
  api.bulkDeletePreview.mockResolvedValue({ data: makePreview([chard, variety, { ...variety, id: 20 }]) });
  renderDialog([10, 12, 20]);
  expect(await screen.findByRole('heading')).toHaveTextContent(question.replace('\u202f', ' '));
});
