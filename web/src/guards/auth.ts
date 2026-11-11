/** The check for who is signed in. */

import type { Me } from '../types';
import { flag, guard, num, opt, orNull, recordOf, shape, text } from './shape';

const me = shape<Me>({
  authEnabled: flag,
  user: orNull(shape<NonNullable<Me['user']>>({ name: text, role: text })),
  expiresIn: opt(orNull(num)),
  pages: opt(recordOf(text)),
});

/** GET /api/auth/me. */
export const meGuard = guard<Me>('your sign-in details', me);
