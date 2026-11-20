/** The checks for the Users page. */

import type { AccountRequestRecord, ModuleInfo, RequestInfo, RequestsResponse, UserRecord, UserResult, UsersResponse } from '../types';
import { flag, guard, listOf, num, opt, orNull, recordOf, shape, text } from './shape';

const userRecord = shape<UserRecord>({
  name: text,
  displayName: text,
  role: text,
  modules: listOf(text),
  language: orNull(text),
  source: text,
  breakGlass: flag,
  disabled: flag,
  expires: orNull(num),
  mustChange: flag,
  created: orNull(num),
  createdBy: orNull(text),
  lastSignIn: orNull(num),
});

const moduleInfo = shape<ModuleInfo>({ id: text, label: text, page: text, adminOnly: flag });

/** GET /api/users. */
export const usersGuard = guard<UsersResponse>(
  'the users',
  shape<UsersResponse>({
    users: listOf(userRecord),
    modules: listOf(moduleInfo),
    presets: recordOf(listOf(text)),
    durable: flag,
    editable: flag,
    failing: flag,
    secure: flag,
  }),
);

/** POST /api/users, PATCH /api/users/:name and POST /api/users/:name/password: the user as they are now. */
export const userResultGuard = guard<UserResult>('the user', shape<UserResult>({ user: userRecord }));

/** GET /api/auth/request: whether the form is offered, and the pages it may ask for. */
export const requestInfoGuard = guard<RequestInfo>(
  'the form for an account',
  shape<RequestInfo>({
    enabled: flag,
    pages: opt(listOf(shape<{ id: string; label: string }>({ id: text, label: text }))),
    nameMax: opt(num),
    reasonMax: opt(num),
  }),
);

const accountRequest = shape<AccountRequestRecord>({ id: text, name: text, pages: listOf(text), reason: text, created: num });

/** GET /api/users/requests. */
export const requestsGuard = guard<RequestsResponse>('the requests for an account', shape<RequestsResponse>({ enabled: flag, max: num, requests: listOf(accountRequest) }));
