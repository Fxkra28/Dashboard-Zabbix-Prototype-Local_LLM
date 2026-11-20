import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The service tree where a service sits under two parents, which a shared dependency does (BK-102). It appears under each, with what is below it; a service below it is counted once however
 * many ways lead to it; a cycle does not hang the request; the worst status of a parent follows its children. The services are made up.
 */
const { zbxMock } = vi.hoisted(() => ({ zbxMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../clients/zabbix.js')>()), zbx: zbxMock }));

const { getServiceTree } = await import('../services/services.js');

const svc = (id: number, parents: number[], children: number[], over: Record<string, unknown> = {}) => ({
  serviceid: String(id),
  name: `Service ${id}`,
  status: '-1',
  algorithm: '1',
  sortorder: String(id),
  parents: parents.map((p) => ({ serviceid: String(p), name: `Service ${p}` })),
  children: children.map((c) => ({ serviceid: String(c), name: `Service ${c}` })),
  tags: [],
  ...over,
});

const estate = (services: ReturnType<typeof svc>[]) => {
  zbxMock.mockReset();
  zbxMock.mockImplementation(async (method: string) => (method === 'service.get' ? services : []));
};
type Node = Awaited<ReturnType<typeof getServiceTree>>['tree'][number];
const names = (nodes: Node[]) => nodes.map((n) => n.name);

beforeEach(() => zbxMock.mockReset());

describe('a service under two parents', () => {
  // 1 and 2 are roots; 3 is below both; 4 is below 3.
  const shared = [svc(1, [], [3]), svc(2, [], [3]), svc(3, [1, 2], [4]), svc(4, [3], [])];

  it('is shown under each of them, with what is below it', async () => {
    estate(shared);
    const { tree } = await getServiceTree();
    expect(names(tree)).toEqual(['Service 1', 'Service 2']);
    for (const root of tree) {
      expect(names(root.children)).toEqual(['Service 3']);
      expect(names(root.children[0].children)).toEqual(['Service 4']);
    }
  });

  it('is counted once in the total of the estate, and what is below a parent is counted in its own right', async () => {
    estate(shared);
    const { tree, total } = await getServiceTree();
    expect(total).toBe(4);
    expect(tree[0].descendants).toBe(2);
    expect(tree[1].descendants).toBe(2);
  });

  it('counts a service once below a parent that reaches it by two ways', async () => {
    // 1 has children 2 and 3, and 3 has child 2: 2 is below 1 by two ways and is one descendant.
    estate([svc(1, [], [2, 3]), svc(2, [1, 3], []), svc(3, [1], [2])]);
    const { tree } = await getServiceTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].descendants).toBe(2);
  });

  it('gives each parent the worst status of what is below it, a child that is worse making the parent as bad', async () => {
    estate([svc(1, [], [3], { status: '0' }), svc(2, [], [3], { status: '-1' }), svc(3, [1, 2], [], { status: '4' })]);
    const { tree, worst, degraded } = await getServiceTree();
    expect(tree.map((n) => n.worst)).toEqual([4, 4]);
    expect(worst).toBe(4);
    expect(degraded).toBe(2);
  });

  it('orders the children by their sort order, then by name, and the roots the same way', async () => {
    estate([
      svc(1, [], [5, 4, 3]),
      svc(3, [1], [], { sortorder: '2', name: 'B' }),
      svc(4, [1], [], { sortorder: '2', name: 'A' }),
      svc(5, [1], [], { sortorder: '1', name: 'C' }),
      svc(0, [], [], { sortorder: '0', name: 'Zero root' }),
    ]);
    const { tree } = await getServiceTree();
    expect(names(tree)).toEqual(['Zero root', 'Service 1']);
    expect(names(tree[1].children)).toEqual(['C', 'A', 'B']);
  });
});

describe('a tree that is not one', () => {
  it('does not hang on a service that is its own ancestor: the loop is left out below the point where it closes', async () => {
    // 1 is a root; 1 -> 2 -> 3 -> 2 closes a loop at 2.
    estate([svc(1, [], [2]), svc(2, [1, 3], [3]), svc(3, [2], [2])]);
    const { tree } = await getServiceTree();
    expect(names(tree)).toEqual(['Service 1']);
    expect(names(tree[0].children)).toEqual(['Service 2']);
    expect(names(tree[0].children[0].children)).toEqual(['Service 3']);
    expect(tree[0].children[0].children[0].children).toEqual([]);
  });

  it('shows nothing for services that are all below one another, which have no root, and still counts them', async () => {
    estate([svc(1, [2], [2]), svc(2, [1], [1])]);
    const { tree, total } = await getServiceTree();
    expect(tree).toEqual([]);
    expect(total).toBe(2);
  });

  it('leaves out a child that the answer names and does not hold', async () => {
    estate([svc(1, [], [2, 99]), svc(2, [1], [])]);
    const { tree } = await getServiceTree();
    expect(names(tree[0].children)).toEqual(['Service 2']);
  });

  it('is empty for an estate with no services, without a cut', async () => {
    estate([]);
    const answer = await getServiceTree();
    expect(answer).toMatchObject({ tree: [], total: 0, degraded: 0, worst: -1 });
    expect('truncated' in answer).toBe(false);
  });
});
