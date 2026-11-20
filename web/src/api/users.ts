/** The calls behind the Users page and the change of one's own password (ADR-0017). */

import type { NewRequest, NewUser, PasswordChanged, RequestInfo, RequestsResponse, UserPatch, UserResult, UsersResponse } from '../types';
import { requestInfoGuard, requestsGuard, userResultGuard, usersGuard } from '../guards';
import { patch, post, request } from './client';
import { recordSession } from './session';

export const usersApi = {
  /** Administrators only: the BFF refuses the others. */
  users: () => request<UsersResponse>('/api/users', { guard: usersGuard }),
  createUser: (body: NewUser) => post<UserResult>('/api/users', body, userResultGuard),
  /** The name is written into the path here, once, so that a name with a character a path does not take cannot reach another route. */
  updateUser: (name: string, changes: UserPatch) => patch<UserResult>('/api/users/{name}'.replace('{name}', encodeURIComponent(name)), changes, userResultGuard),
  resetUserPassword: (name: string, password: string, mustChange = true) =>
    post<UserResult>('/api/users/{name}/password'.replace('{name}', encodeURIComponent(name)), { password, mustChange }, userResultGuard),
  /** The sign-in page asks, signed out: whether the form for an account is offered (FR-62). */
  requestInfo: () => request<RequestInfo>('/api/auth/request', { guard: requestInfoGuard }),
  /** A person who is not signed in leaves a request. The answer is the same whatever became of it, so the page says only that it was received. */
  sendRequest: (body: NewRequest) => post<{ ok: boolean }>('/api/auth/request', body),
  /** Administrators only: the requests waiting. */
  accountRequests: () => request<RequestsResponse>('/api/users/requests', { guard: requestsGuard }),
  /** Makes the account the administrator typed and takes the request off the list; the id goes into the path once, encoded. */
  approveRequest: (id: string, body: NewUser) => post<UserResult>('/api/users/requests/{id}/approve'.replace('{id}', encodeURIComponent(id)), body, userResultGuard),
  refuseRequest: (id: string) => post<{ ok: boolean }>('/api/users/requests/{id}/refuse'.replace('{id}', encodeURIComponent(id)), undefined),
  /** One's own password: the current one, then the new one. The answer renews the session, so the page keeps the new timing. */
  changePassword: async (current: string, password: string) => {
    const done = await post<PasswordChanged>('/api/auth/password', { current, password });
    recordSession(done.expiresIn, done.user);
    return done;
  },
};
