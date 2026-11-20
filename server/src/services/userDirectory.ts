import { config } from '../core/config.js';
import { adminWarning, createDirectory, legacyHashWarning, readEnvUsers, type Directory } from '../security/accounts.js';
import { openUsers } from '../security/userStore.js';

/**
 * The portal's one directory of users, opened once at start-up (index.ts) from PORTAL_STATE_DIR (ADR-0017). Until then, and in the tests, it is the users of `.env` alone.
 */

let current: Directory | null = null;

/** Opens the file of users, adds the users of `.env` that it does not hold, and makes the result the directory. Never throws: with no folder the users stay in `.env`. */
export async function initUsers(warn: (message: string) => void): Promise<Directory> {
  const store = await openUsers(config.stateDir, warn);
  const envUsers = readEnvUsers(warn);
  const directory = createDirectory(envUsers, store);
  await directory.seed(warn);
  const noAdmin = adminWarning(directory);
  if (noAdmin) warn(noAdmin);
  const older = legacyHashWarning(envUsers);
  if (older) warn(older);
  current = directory;
  return directory;
}

export function userDirectory(): Directory {
  current ??= createDirectory(readEnvUsers());
  return current;
}

/** For the tests: put a directory of their own in place. */
export function useUserDirectory(directory: Directory | null): void {
  current = directory;
}
