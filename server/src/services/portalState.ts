import { config } from '../core/config.js';
import { memoryState, openState, type StateStore } from '../core/state.js';

/**
 * The portal's one state store, opened once at start-up (index.ts) from PORTAL_STATE_DIR. Until then, and in the tests,
 * it is a store in memory alone.
 */

let current: StateStore = memoryState();

export async function initPortalState(warn: (message: string) => void): Promise<StateStore> {
  current = await openState(config.stateDir, warn);
  return current;
}

export const portalState = (): StateStore => current;

/** For the tests: put a store of their own in place. */
export function usePortalState(store: StateStore): void {
  current = store;
}
