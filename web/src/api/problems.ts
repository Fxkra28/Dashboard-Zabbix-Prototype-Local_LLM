/** The calls behind the problem list: the list, the live stream's address and the portal's one write. */

import type { AcknowledgeResult, Problem } from '../types';
import { problemListGuard } from '../guards';
import { post, request } from './client';

/** The live stream. EventSource sends the session cookie like any same-origin request, so no token rides in the URL. */
export function streamUrl(): string {
  return '/bff/api/stream';
}

export const problemsApi = {
  problems: () => request<Problem[]>('/api/problems', { guard: problemListGuard }),
  /** The portal's only write. Operator role + ZABBIX_WRITE_TOKEN required. */
  acknowledge: (body: {
    eventids: string[];
    message?: string;
    close?: boolean;
    acknowledge?: boolean;
  }) => post<AcknowledgeResult>('/api/problems/acknowledge', body),
};
