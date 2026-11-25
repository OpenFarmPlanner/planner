import { createContext } from 'react';

export interface ParcelRotationMembership {
  group: string;
  position: number;
  size: number;
}

export const ParcelRotationContext = createContext<{
  memberships: ReadonlyMap<number, ParcelRotationMembership>;
  configure?: (fieldId: number) => void;
}>({ memberships: new Map() });
