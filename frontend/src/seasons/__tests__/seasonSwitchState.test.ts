import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearSeasonSwitchState,
  peekSeasonSwitchState,
  registerSeasonSwitchState,
  stashSeasonSwitchState,
} from '../seasonSwitchState';

describe('seasonSwitchState', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('carries a registered snapshot across a season switch of the same project', () => {
    const unregister = registerSeasonSwitchState('search', () => ({ query: 'tomate' }));
    stashSeasonSwitchState(7);
    unregister();

    expect(peekSeasonSwitchState(7, 'search')).toEqual({ query: 'tomate' });
  });

  it('never restores a snapshot into another project', () => {
    const unregister = registerSeasonSwitchState('search', () => ({ query: 'tomate' }));
    stashSeasonSwitchState(7);
    unregister();

    expect(peekSeasonSwitchState(8, 'search')).toBeNull();
  });

  it('is consumed once the page has read it', () => {
    const unregister = registerSeasonSwitchState('search', () => ({ query: 'tomate' }));
    stashSeasonSwitchState(7);
    unregister();

    clearSeasonSwitchState(7, 'search');
    expect(peekSeasonSwitchState(7, 'search')).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('stashes nothing for pages that are no longer mounted', () => {
    registerSeasonSwitchState('search', () => ({ query: 'tomate' }))();
    stashSeasonSwitchState(7);

    expect(peekSeasonSwitchState(7, 'search')).toBeNull();
  });
});
