import type { Crop, CropTimingWindow, TimingWindowKind } from '../api/types';
import { TIMING_WINDOW_KINDS, windowsOfKind } from './timingWindows';

export interface KindWindows {
  kind: TimingWindowKind;
  windows: CropTimingWindow[];
  inherited: boolean;
}

/** The crop's effective timing windows, grouped per kind that has any. */
export function collectKinds(crop: Crop): KindWindows[] {
  const effective = crop.effective_timing_windows
    ?? (crop.timing_windows ?? []).map((window) => ({ ...window, inherited: false }));
  return TIMING_WINDOW_KINDS
    .map((kind) => {
      const windows = windowsOfKind(effective, kind);
      return { kind, windows, inherited: windows.length > 0 && windows.every((window) => window.inherited) };
    })
    .filter((entry) => entry.windows.length > 0);
}

/** Whether the crop has any effective timing window to show. */
export function hasTimingWindows(crop: Crop): boolean {
  return collectKinds(crop).length > 0;
}
