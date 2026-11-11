/**
 * Check that docs/erd/database/ERD-Database.erd and ERD-Database.mmd describe
 * the same schema.
 *
 *   ./server/node_modules/.bin/tsx tools/check/erd.check.ts            (from the repository root)
 *
 * Why this exists. The database ERD now exists twice: as a Mermaid picture with a
 * committed PDF, and as an .erd document the ERD Designer CLI can edit and export
 * DDL from. Two hand-maintained copies of one model is the exact shape that has
 * drifted every previous time in this project: the endpoint table drifted twice,
 * the entity count disagreed between two READMEs about a byte-identical file, and
 * a line citation moved the moment 95 lines were deleted. Neither file is the
 * source of truth on its own; agreeing is what makes them trustworthy, so this
 * compares them and fails on any difference.
 *
 * It checks four things, in both directions:
 *   - the set of tables
 *   - the set of columns per table, and each column's type
 *   - which columns are primary keys
 *   - the foreign keys: parent table, child table, child column
 *
 * The 14 relations Mermaid draws dashed are deliberately absent from the .erd:
 * MySQL has no foreign key for them, so they are recorded in a memo instead. This
 * check ignores them, and fails if a dashed relation ever turns into a real one.
 *
 * Read-only. No npm dependency: the .erd is JSON, and the Mermaid is scanned for
 * the four shapes above rather than parsed, the same trade openapi.check.ts made
 * with the OpenAPI spec.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ERD_DIR = join(HERE, '..', '..', 'docs', 'erd', 'database');

export interface Column {
  name: string;
  type: string;
  primaryKey: boolean;
}
export interface Relation {
  parent: string;
  child: string;
  childColumn: string;
}
export interface Model {
  tables: Map<string, Column[]>;
  relations: Relation[];
}

/** columnTypeId values the ERD Designer uses for MySQL, for the types this schema needs. */
const TYPE_BY_ID: Record<number, string> = { 15: 'int', 17: 'bigint', 33: 'double', 322: 'text', 312: 'varchar' };

/**
 * Every bigint in this schema is unsigned (ERD-Database.md). The diagram writes the short form, so
 * both sides are normalised to the long one: a bigint that loses `unsigned` in the .erd then fails
 * the check instead of quietly exporting the wrong DDL.
 */
const normaliseType = (type: string) => (type === 'bigint' ? 'bigint unsigned' : type);

const COLUMN = /^\s{12}(\S+)\s+(\w+)(?:\s+(PK|FK|UK|PK,FK|PK,UK|FK,UK|PK,FK,UK))?(?:\s+"[^"]*")?\s*$/;
const RELATION = /^\s+(\w+)\s+[|}o][o|{]?(--|\.\.)[o|{}][|{}]?\s+(\w+)\s*:\s*"([^"]*)"/;
const OPEN = /^\s{8}(\w+)\s*\{\s*$/;
const CLOSE = /^\s{8}\}\s*$/;

export function parseMermaid(source: string): Model {
  const tables = new Map<string, Column[]>();
  const relations: Relation[] = [];
  let current: string | null = null;

  for (const line of source.split('\n')) {
    const open = OPEN.exec(line);
    if (open) {
      current = open[1];
      tables.set(current, []);
      continue;
    }
    if (CLOSE.test(line)) {
      current = null;
      continue;
    }
    if (current) {
      const col = COLUMN.exec(line);
      if (col) {
        tables.get(current)!.push({
          name: col[2],
          type: normaliseType(col[1]),
          primaryKey: (col[3] ?? '').includes('PK'),
        });
      }
      continue;
    }
    const rel = RELATION.exec(line);
    // a dashed line means Zabbix joins these in code, so there is no foreign key
    if (rel && rel[2] === '--') {
      relations.push({ parent: rel[1], child: rel[3], childColumn: rel[4].split(',')[0].trim() });
    }
  }
  return { tables, relations };
}

interface ErdFile {
  tableViewModels: { tableModel: { tableModelId: string; physicalName: string; columnModelIds: string[] } }[];
  columnModels: { columnModelId: string; columnShareModelId: string; primaryKey?: boolean }[];
  columnShareModels: {
    columnShareModelId: string;
    physicalName: string;
    columnTypeId: number;
    precision?: string;
    unsigned?: boolean;
  }[];
  relationViewModels: {
    relationModel: {
      parentTableModelId: string;
      childTableModelId: string;
      relationPairs: { childColumnModelId: string }[];
    };
  }[];
}

export function parseErd(json: string): Model {
  const doc = JSON.parse(json) as ErdFile;
  const shares = new Map(doc.columnShareModels.map((s) => [s.columnShareModelId, s]));
  const columns = new Map(doc.columnModels.map((c) => [c.columnModelId, c]));

  const tables = new Map<string, Column[]>();
  const tableNameById = new Map<string, string>();
  const columnNameById = new Map<string, string>();

  for (const view of doc.tableViewModels) {
    const t = view.tableModel;
    tableNameById.set(t.tableModelId, t.physicalName);
    const cols: Column[] = [];
    for (const id of t.columnModelIds) {
      const col = columns.get(id);
      if (!col) throw new Error(`column ${id} referenced by ${t.physicalName} is missing`);
      const share = shares.get(col.columnShareModelId);
      if (!share) throw new Error(`column-share for ${id} is missing`);
      const base = TYPE_BY_ID[share.columnTypeId] ?? `type#${share.columnTypeId}`;
      const sized = share.precision ? `${base}(${share.precision})` : base;
      cols.push({
        name: share.physicalName,
        type: share.unsigned ? `${sized} unsigned` : sized,
        primaryKey: col.primaryKey === true,
      });
      columnNameById.set(id, share.physicalName);
    }
    tables.set(t.physicalName, cols);
  }

  const relations = doc.relationViewModels.map((v) => {
    const r = v.relationModel;
    return {
      parent: tableNameById.get(r.parentTableModelId) ?? '?',
      child: tableNameById.get(r.childTableModelId) ?? '?',
      childColumn: columnNameById.get(r.relationPairs[0]?.childColumnModelId) ?? '?',
    };
  });
  return { tables, relations };
}

const relKey = (r: Relation) => `${r.parent} -> ${r.child}.${r.childColumn}`;
const colKey = (c: Column) => `${c.name} ${c.type}${c.primaryKey ? ' PK' : ''}`;

export function compare(mmd: Model, erd: Model): string[] {
  const problems: string[] = [];

  for (const name of mmd.tables.keys()) if (!erd.tables.has(name)) problems.push(`${name}: in the diagram, missing from the .erd`);
  for (const name of erd.tables.keys()) if (!mmd.tables.has(name)) problems.push(`${name}: in the .erd, missing from the diagram`);

  for (const [name, left] of mmd.tables) {
    const right = erd.tables.get(name);
    if (!right) continue;
    const a = left.map(colKey).sort();
    const b = right.map(colKey).sort();
    for (const c of a) if (!b.includes(c)) problems.push(`${name}.${c}: in the diagram, not in the .erd`);
    for (const c of b) if (!a.includes(c)) problems.push(`${name}.${c}: in the .erd, not in the diagram`);
  }

  const a = mmd.relations.map(relKey).sort();
  const b = erd.relations.map(relKey).sort();
  for (const r of a) if (!b.includes(r)) problems.push(`foreign key ${r}: in the diagram, not in the .erd`);
  for (const r of b) if (!a.includes(r)) problems.push(`foreign key ${r}: in the .erd, not in the diagram`);

  return problems;
}

/** Fixtures first. A checker that has never failed has never been tested. */
function selfTest(): string[] {
  const failures: string[] = [];
  const check = (label: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) failures.push(`${label}: got ${g}, wanted ${w}`);
  };

  const mmd = [
    'erDiagram',
    '    subgraph D["Domain"]',
    '        parent {',
    '            bigint pid PK',
    '            varchar(64) label "a note"',
    '        }',
    '        child {',
    '            bigint cid PK',
    '            bigint pid FK',
    '        }',
    '        parent ||--o{ child : "pid, cascade"',
    '        parent |o..o{ child : "pid, no FK"',
    '    end',
  ].join('\n');

  const parsed = parseMermaid(mmd);
  check('two tables', [...parsed.tables.keys()], ['parent', 'child']);
  check('typed columns', parsed.tables.get('parent')!.map(colKey), ['pid bigint unsigned PK', 'label varchar(64)']);
  check('only the solid relation', parsed.relations.map(relKey), ['parent -> child.pid']);

  const erd = JSON.stringify({
    tableViewModels: [
      { tableModel: { tableModelId: 'T1', physicalName: 'parent', columnModelIds: ['C1', 'C2'] } },
      { tableModel: { tableModelId: 'T2', physicalName: 'child', columnModelIds: ['C3', 'C4'] } },
    ],
    columnModels: [
      { columnModelId: 'C1', columnShareModelId: 'S1', primaryKey: true },
      { columnModelId: 'C2', columnShareModelId: 'S2' },
      { columnModelId: 'C3', columnShareModelId: 'S3', primaryKey: true },
      { columnModelId: 'C4', columnShareModelId: 'S4' },
    ],
    columnShareModels: [
      { columnShareModelId: 'S1', physicalName: 'pid', columnTypeId: 17, unsigned: true },
      { columnShareModelId: 'S2', physicalName: 'label', columnTypeId: 312, precision: '64' },
      { columnShareModelId: 'S3', physicalName: 'cid', columnTypeId: 17, unsigned: true },
      { columnShareModelId: 'S4', physicalName: 'pid', columnTypeId: 17, unsigned: true },
    ],
    relationViewModels: [
      { relationModel: { parentTableModelId: 'T1', childTableModelId: 'T2', relationPairs: [{ childColumnModelId: 'C4' }] } },
    ],
  });

  const fromErd = parseErd(erd);
  check('the two agree', compare(parsed, fromErd), []);

  // and it must actually fail when they disagree
  const broken = JSON.parse(erd);
  broken.columnShareModels[1].precision = '128';
  check('a changed type is caught', compare(parsed, parseErd(JSON.stringify(broken))).length, 2);

  const dropped = JSON.parse(erd);
  dropped.relationViewModels = [];
  check('a dropped foreign key is caught', compare(parsed, parseErd(JSON.stringify(dropped))).length, 1);

  const signed = JSON.parse(erd);
  delete signed.columnShareModels[0].unsigned;
  check('a bigint that lost unsigned is caught', compare(parsed, parseErd(JSON.stringify(signed))).length, 2);

  return failures;
}

const selfFailures = selfTest();
if (selfFailures.length) {
  console.error(`erd.check: the checker itself is broken, ${selfFailures.length} self-test failure(s):`);
  for (const f of selfFailures) console.error(`  ${f}`);
  process.exit(2);
}

const mmdModel = parseMermaid(readFileSync(join(ERD_DIR, 'ERD-Database.mmd'), 'utf8'));
const erdModel = parseErd(readFileSync(join(ERD_DIR, 'ERD-Database.erd'), 'utf8'));
const problems = compare(mmdModel, erdModel);

if (problems.length) {
  console.error(`erd.check: ${problems.length} difference(s) between the diagram and the .erd:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const columnCount = [...mmdModel.tables.values()].reduce((n, c) => n + c.length, 0);
console.log(
  `erd.check: ${mmdModel.tables.size} tables, ${columnCount} columns, ${mmdModel.relations.length} foreign keys. The diagram and the .erd agree.`,
);
