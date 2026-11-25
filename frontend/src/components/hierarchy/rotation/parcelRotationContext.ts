import { createContext } from 'react';

export interface ParcelRotationMembership {
  group: string;
  position: number;
  size: number;
}

export const ParcelRotationContext = createContext<{
  memberships: ReadonlyMap<number, ParcelRotationMembership>;
  /** Opens the project-wide rotation-group management; absent for users who cannot change it. */
  manage?: () => void;
}>({ memberships: new Map() });

/** Compact "Group · position/size" label shared by the list column and the mobile list. */
export function formatParcelRotationMembership(membership: ParcelRotationMembership): string {
  return `${membership.group} · ${membership.position}/${membership.size}`;
}
