import { describe, expect, it } from 'vitest';
import type { ModuleInfo, UserRecord } from '../../types';
import { effectiveAccess, expiryOf, grantableFor, statusOf } from './access';

const modules: ModuleInfo[] = [
  { id: 'dashboard', label: 'Dashboard', page: '/', adminOnly: false },
  { id: 'sla', label: 'SLA', page: '/sla', adminOnly: false },
  { id: 'inventory', label: 'Inventory & ownership scorecard', page: '/reports/inventory', adminOnly: true },
  { id: 'users', label: 'Users and access', page: '/users', adminOnly: true },
];

const user = (over: Partial<UserRecord> = {}): UserRecord => ({
  name: 'budi.santoso',
  displayName: 'Budi',
  role: 'guest',
  modules: ['sla'],
  language: null,
  source: 'file',
  breakGlass: false,
  disabled: false,
  expires: null,
  mustChange: false,
  created: 1,
  createdBy: 'root',
  lastSignIn: null,
  ...over,
});

describe('where a user stands', () => {
  it('says first that a user is kept in .env, and which one always signs in', () => {
    expect(statusOf(user({ source: 'env' }), 0)).toEqual({ key: 'env', label: 'Kept in .env' });
    expect(statusOf(user({ source: 'env', breakGlass: true }), 0)).toEqual({ key: 'env', label: 'Kept in .env, always signs in' });
  });

  it('says disabled, then expired, then a temporary password, then active', () => {
    expect(statusOf(user({ disabled: true, mustChange: true }), 0).key).toBe('disabled');
    expect(statusOf(user({ expires: 100, mustChange: true }), 100).key).toBe('expired');
    expect(statusOf(user({ expires: 100 }), 99).key).toBe('active');
    expect(statusOf(user({ mustChange: true }), 0)).toEqual({ key: 'must-change', label: 'Must change the password' });
    expect(statusOf(user(), 0)).toEqual({ key: 'active', label: 'Active' });
  });
});

describe('what a role can be given and can do', () => {
  it('keeps an administrator\'s own pages from every role but the administrator', () => {
    expect(grantableFor('guest', modules).map((m) => m.id)).toEqual(['dashboard', 'sla']);
    expect(grantableFor('operator', modules).map((m) => m.id)).toEqual(['dashboard', 'sla']);
    expect(grantableFor('admin', modules).map((m) => m.id)).toEqual(['dashboard', 'sla', 'inventory', 'users']);
  });

  it('lists the pages a user holds, and gives an administrator every one whatever the list says', () => {
    expect(effectiveAccess('guest', ['sla', 'users'], modules).pages).toEqual(['SLA']);
    expect(effectiveAccess('admin', [], modules).pages).toEqual(modules.map((m) => m.label));
  });

  it('says in words what each role does', () => {
    expect(effectiveAccess('guest', [], modules).can).toEqual(['Read what their pages show']);
    expect(effectiveAccess('operator', [], modules).can).toHaveLength(2);
    expect(effectiveAccess('operator', [], modules).can[1]).toContain('Acknowledge and close');
    expect(effectiveAccess('admin', [], modules).can.join(' ')).toMatch(/users.*inventory.*email/s);
  });
});

describe('the expiry date', () => {
  it('is the end of the day chosen, or nothing', () => {
    const at = (text: string) => Date.parse(`${text}:00+07:00`) / 1000;
    expect(expiryOf('2026-12-31', at)).toBe(Date.parse('2026-12-31T23:59:59+07:00') / 1000);
    expect(expiryOf('', at)).toBeNull();
    expect(expiryOf('nonsense', () => Number.NaN)).toBeNull();
  });
});
