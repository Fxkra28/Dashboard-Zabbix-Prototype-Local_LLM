import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A service below several parents is built under each of them, so a few services that share children made a tree of tens of thousands of nodes, which was cached and read by the Assistant (BK-96).
 * The tree is cut at MAX_NODES and says so. The services here are made up.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../clients/zabbix.js')>()), zbx: zbxMock }));

const { getServiceTree, MAX_NODES } = await import('../services/services.js');

const svc = (id: number, parents: number[], children: number[]) => ({
  serviceid: String(id),
  name: `Service ${id}`,
  status: '-1',
  algorithm: '1',
  sortorder: String(id),
  parents: parents.map((p) => ({ serviceid: String(p), name: `Service ${p}` })),
  children: children.map((c) => ({ serviceid: String(c), name: `Service ${c}` })),
  tags: [],
});

/** Layers of four services, each below all four of the layer above, under one root. */
function layers(count: number) {
  const out = [svc(0, [], [1, 2, 3, 4])];
  for (let layer = 1; layer <= count; layer++) {
    const ids = [1, 2, 3, 4].map((k) => (layer - 1) * 4 + k);
    const next = layer === count ? [] : [1, 2, 3, 4].map((k) => layer * 4 + k);
    const parents = layer === 1 ? [0] : [1, 2, 3, 4].map((k) => (layer - 2) * 4 + k);
    for (const id of ids) out.push(svc(id, parents, next));
  }
  return out;
}

const count = (nodes: { children: unknown[] }[]): number => nodes.reduce((n, node) => n + 1 + count(node.children as { children: unknown[] }[]), 0);

beforeEach(() => {
  zbxMock.mockReset();
  zbxMock.mockImplementation(async (method: string) => (method === 'service.get' ? layers(8) : []));
});

describe('the Zabbix service tree (BK-96)', () => {
  it('is cut at MAX_NODES when services share children, and says so', async () => {
    const tree = await getServiceTree();
    expect(tree.truncated).toBe(true);
    expect(count(tree.tree)).toBeLessThanOrEqual(MAX_NODES);
    expect(count(tree.tree)).toBeGreaterThan(MAX_NODES - 10);
    expect(tree.total).toBe(33);
  });

  it('is whole, and says nothing of a cut, when it is small', async () => {
    zbxMock.mockImplementation(async (method: string) => (method === 'service.get' ? layers(2) : []));
    const tree = await getServiceTree();
    expect('truncated' in tree).toBe(false);
    expect(count(tree.tree)).toBe(1 + 4 + 4 * 4);
  });

  it('holds 5,000 nodes at most', () => {
    expect(MAX_NODES).toBe(5_000);
  });
});
