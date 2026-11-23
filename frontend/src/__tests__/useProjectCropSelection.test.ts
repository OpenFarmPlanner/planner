import { act, renderHook } from '@testing-library/react';
import type { Crop } from '../api/types';
import { useProjectCropSelection } from '../crops/useProjectCropSelection';

const project = 7;
const crops: Crop[] = [
  { id: 1, name: 'Tomato', crop_species: 10 },
  { id: 2, name: 'Tomato', crop_species: 10, variety: 'Roma' },
  { id: 3, name: 'Tomato', crop_species: 10, variety: 'Cherry' },
  { id: 4, name: 'Chard' },
];

it('treats mixed parent selection as intent to add the whole group', () => {
  const { result } = renderHook(() => useProjectCropSelection(project, crops));
  act(() => result.current.toggle());
  act(() => result.current.setCropSelected(1, true));
  expect(result.current.selected).toEqual(new Set([1, 2, 3]));
  expect(result.current.isMixed(1)).toBe(false);

  act(() => result.current.setCropSelected(3, false));
  expect(result.current.selected).toEqual(new Set([2]));
  expect(result.current.isMixed(1)).toBe(true);
  act(() => result.current.setCropSelected(3, true));
  expect(result.current.selected).toEqual(new Set([2, 3]));
  expect(result.current.isMixed(1)).toBe(true);
  act(() => result.current.openSelected());
  expect(result.current.target).toEqual({ expected_project_id: project, scope: 'selected', crop_ids: [2, 3] });

  act(() => result.current.closeTarget());
  act(() => result.current.setCropSelected(1, true));
  expect(result.current.selected).toEqual(new Set([1, 2, 3]));
  act(() => result.current.setCropSelected(1, false));
  expect(result.current.selected?.size).toBe(0);
  expect(result.current.isMixed(1)).toBe(false);
});

it('keeps Select visible scoped when a filter leaves one variety out', () => {
  const { result } = renderHook(() => useProjectCropSelection(project, crops));
  act(() => result.current.toggle());
  const visibleCropIds = [1, 2];
  const eligible = result.current.eligibleVisibleIds(visibleCropIds);
  expect(eligible).toEqual([2]);
  act(() => result.current.setSelected(eligible, true));
  expect(result.current.selected).toEqual(new Set([2]));
  expect(result.current.isMixed(1)).toBe(true);

  act(() => result.current.setCropSelected(1, true));
  expect(result.current.selected).toEqual(new Set([1, 2, 3]));
  const clear = result.current.eligibleVisibleIds(visibleCropIds);
  expect(clear).toEqual([1, 2]);
  act(() => result.current.setSelected(clear, false));
  expect(result.current.selected).toEqual(new Set([3]));
  expect(result.current.isMixed(1)).toBe(true);
});

it('keeps new varieties unselected after a reload and resets on project changes', () => {
  const { result, rerender } = renderHook(
    ({ projectId, rows }) => useProjectCropSelection(projectId, rows),
    { initialProps: { projectId: project, rows: crops } },
  );
  act(() => result.current.toggle());
  act(() => result.current.setCropSelected(1, true));
  const rows: Crop[] = [...crops, { id: 5, name: 'Tomato', crop_species: 10, variety: 'Beefsteak' }];
  rerender({ projectId: project, rows });
  expect(result.current.selected).toEqual(new Set([2, 3]));
  expect(result.current.isMixed(1)).toBe(true);
  act(() => result.current.openSelected());
  rerender({ projectId: project + 1, rows });
  expect(result.current.selected).toBeNull();
  expect(result.current.target).toBeNull();
});
