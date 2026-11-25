import { createContext } from 'react';

export type ParcelRotationLoadStatus = 'loading' | 'ready' | 'error';

export interface ParcelRotationMembership {
  group: string;
  position: number;
  size: number;
}

export const ParcelRotationContext = createContext<{
  memberships: ReadonlyMap<number, ParcelRotationMembership>;
  /** Memberships are only meaningful once `ready`; before that a parcel is not known to be unassigned. */
  status: ParcelRotationLoadStatus;
  /** Opens the project-wide rotation-group management; absent for users who cannot change it. */
  manage?: () => void;
}>({ memberships: new Map(), status: 'ready' });

/** Compact "Group · position/size" label shared by the list column and the mobile list. */
export function formatParcelRotationMembership(membership: ParcelRotationMembership): string {
  return `${membership.group} · ${membership.position}/${membership.size}`;
}
