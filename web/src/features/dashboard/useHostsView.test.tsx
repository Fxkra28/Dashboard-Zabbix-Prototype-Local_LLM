import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { api } from '../../api';
import { useHostsView } from './useHostsView';
import { devicesResponse, topHostsResponse, webMonitoringResponse } from '../../__tests__/hosts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useHostsView', () => {
  it('asks for the devices, the busiest hosts and the web scenarios once each, and again every minute', async () => {
    vi.useFakeTimers();
    const devices = vi.spyOn(api, 'devices').mockResolvedValue(devicesResponse());
    const top = vi.spyOn(api, 'topHosts').mockResolvedValue(topHostsResponse());
    const web = vi.spyOn(api, 'webMonitoring').mockResolvedValue(webMonitoringResponse());
    const calls = () => [devices.mock.calls.length, top.mock.calls.length, web.mock.calls.length];
    renderHook(() => useHostsView());
    await act(async () => undefined);
    expect(calls()).toEqual([1, 1, 1]);
    await act(async () => vi.advanceTimersByTime(59_999));
    expect(calls()).toEqual([1, 1, 1]);
    await act(async () => vi.advanceTimersByTime(1));
    expect(calls()).toEqual([2, 2, 2]);
  });

  it('holds the three answers for the view, each with when it came', async () => {
    vi.spyOn(api, 'devices').mockResolvedValue(devicesResponse());
    vi.spyOn(api, 'topHosts').mockResolvedValue(topHostsResponse());
    vi.spyOn(api, 'webMonitoring').mockResolvedValue(webMonitoringResponse());
    const { result } = renderHook(() => useHostsView());
    await act(async () => undefined);
    expect(result.current.devices.data?.devices).toHaveLength(9);
    expect(result.current.top.data?.metrics.map((m) => m.key)).toEqual(['cpu', 'memory']);
    expect(result.current.devices.updatedAt).toEqual(expect.any(Number));
    expect(result.current.top.updatedAt).toEqual(expect.any(Number));
    expect(result.current.web.data?.total).toBe(7);
    expect(result.current.web.updatedAt).toEqual(expect.any(Number));
  });
});
