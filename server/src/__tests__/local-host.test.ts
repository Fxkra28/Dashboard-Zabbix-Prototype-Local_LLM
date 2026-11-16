import { describe, expect, it } from 'vitest';
import { isLocalBaseUrl } from '../core/localHost.js';

/**
 * Whether a model's address is on this machine or its own network (SC-53). The notice, `aiExternal` of /api/health and the `external`
 * field of the `ai_call` log line all follow it, so a model on a public host is never reported as "nothing left".
 */

describe('isLocalBaseUrl', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://LOCALHOST:11434/v1/',
    'http://127.0.0.1:11434/v1',
    'http://127.12.0.3/v1',
    'http://[::1]:11434/v1',
    'http://host.docker.internal:11434/v1',
    'http://10.9.8.7:11434/v1',
    'http://172.16.0.5:11434/v1',
    'http://172.31.255.254:11434/v1',
    'http://192.168.1.20:11434/v1',
    'http://169.254.10.20:11434/v1',
    'http://[fd12:3456:789a::1]:11434/v1',
    'http://[fe80::1]:11434/v1',
    'http://ollama:11434/v1',
    'http://model-box:8000/v1',
    'http://gpu.hcml.local:11434/v1',
    'http://gpu.office.internal/v1',
    'http://gpu.office.lan/v1',
    'http://gpu.home.arpa/v1',
    'http://gpu.example.localdomain/v1',
  ])('counts %s as local', (url) => {
    expect(isLocalBaseUrl(url)).toBe(true);
  });

  it.each([
    'https://gateway.example.com/v1',
    'https://api.openai.com/v1',
    'http://8.8.8.8:11434/v1',
    'http://172.32.0.1:11434/v1',
    'http://172.15.0.1:11434/v1',
    'http://192.169.1.1/v1',
    'http://11.0.0.1/v1',
    'http://100.64.1.2:11434/v1',
    'http://[2001:db8::1]:11434/v1',
    'http://ollama.hcml.co.id:11434/v1',
    'http://notlocalhost.com/v1',
    'http://localhost.example.com/v1',
    'http://10.0.0.1.example.com/v1',
  ])('counts %s as outside the machine and its network', (url) => {
    expect(isLocalBaseUrl(url)).toBe(false);
  });

  it('cannot tell for an address that is not a URL, and says outside', () => {
    for (const bad of ['', 'localhost:11434', 'not a url', 'http://', '//host/v1']) expect(isLocalBaseUrl(bad), bad).toBe(false);
  });

  it('is not fooled by credentials or a path that name a local host', () => {
    expect(isLocalBaseUrl('https://localhost@gateway.example.com/v1')).toBe(false);
    expect(isLocalBaseUrl('https://gateway.example.com/localhost/v1')).toBe(false);
    expect(isLocalBaseUrl('https://gateway.example.com/v1?host=127.0.0.1')).toBe(false);
  });
});
