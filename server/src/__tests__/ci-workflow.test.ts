import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The CI workflow, .github/workflows/ci.yml, read as plain text.
 *
 * Nothing runs the workflow until it is pushed, and a step that quietly goes missing looks the same
 * as a step that passes. This reads the file for the things the checklist asked CI to do, and for
 * the paths and npm scripts those steps name. There is no YAML parser in the dependencies, so it
 * reads only the shape this file uses: two-space blocks, `- key: value` steps, and `#` comments.
 */
interface Step {
  name?: string;
  uses?: string;
  run?: string;
  'working-directory'?: string;
}

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const text = readFileSync(root('.github/workflows/ci.yml'), 'utf8');

// A plain scalar ends at ` #`, as in YAML.
const lines = text
  .split('\n')
  .map((l) => l.replace(/\s+#.*$/, '').trimEnd())
  .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2');

/** The `key: value` lines indented one level (two spaces) under a top-level or job-level key. */
function block(header: RegExp, indent: number): Record<string, string> {
  const start = lines.findIndex((l) => header.test(l));
  const out: Record<string, string> = {};
  if (start < 0) return out;
  for (const l of lines.slice(start + 1)) {
    const lead = l.length - l.trimStart().length;
    if (lead <= indent) break;
    if (lead === indent + 2) {
      const m = /^\s*([\w-]+):\s*(.*)$/.exec(l);
      if (m) out[m[1]] = unquote(m[2]);
    }
  }
  return out;
}

/** Each job's steps. A step starts at a `- key:` line and takes the keys written beneath it. */
function readJobs(): Record<string, { permissions: Record<string, string>; steps: Step[] }> {
  const jobs: Record<string, { permissions: Record<string, string>; steps: Step[] }> = {};
  const from = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  let job: string | undefined;
  let step: Step | undefined;
  for (const l of lines.slice(from + 1)) {
    const lead = l.length - l.trimStart().length;
    if (lead === 0) break;
    const jobHead = /^ {2}([\w-]+):\s*$/.exec(l);
    if (jobHead) {
      job = jobHead[1];
      jobs[job] = { permissions: {}, steps: [] };
      step = undefined;
      continue;
    }
    if (!job) continue;
    const item = /^ {6}- ([\w-]+):\s*(.*)$/.exec(l);
    if (item) {
      step = { [item[1]]: unquote(item[2]) };
      jobs[job].steps.push(step);
      continue;
    }
    const key = /^ {8}([\w-]+):\s*(.*)$/.exec(l);
    if (key && step) (step as Record<string, string>)[key[1]] = unquote(key[2]);
    if (/^ {4}permissions:/.test(l)) jobs[job].permissions = { declared: l.trim() };
  }
  return jobs;
}

const jobs = readJobs();
const serverSteps = jobs.server?.steps ?? [];
const webSteps = jobs.web?.steps ?? [];
const checkSteps = jobs.checks?.steps ?? [];
const images = jobs.images?.steps ?? [];
const secretScan = jobs.secrets?.steps ?? [];
const all = [...serverSteps, ...webSteps, ...checkSteps, ...images, ...secretScan];

/** The step that runs `command` in `dir`, if any. A command may be followed by more arguments. */
const runs = (steps: Step[], command: string | RegExp, dir?: string) =>
  steps.some(
    (s) =>
      s.run !== undefined &&
      (typeof command === 'string' ? s.run === command : command.test(s.run)) &&
      (dir === undefined || s['working-directory'] === dir),
  );

/** The checkers CI runs, as the scripts named in `package.json` at the root and in the workflow's `checks` job. */
const CHECKERS = [
  'tools/check/openapi.check.ts',
  'tools/check/erd.check.ts',
  'web/scripts/css.check.mjs',
  'web/scripts/tokens.check.mjs',
  'web/scripts/markdown.check.ts',
  'web/scripts/units.check.ts',
  'tools/check/links.check.mjs',
  'tools/check/facts.check.mjs',
  'tools/check/diagrams.check.mjs',
  'tools/check/handover.check.mjs',
  'tools/check/parity.check.mjs',
];

describe('.github/workflows/ci.yml', () => {
  it('reads as five jobs, each with its steps', () => {
    expect(Object.keys(jobs).sort()).toEqual(['checks', 'images', 'secrets', 'server', 'web']);
    expect(serverSteps.length).toBeGreaterThan(5);
    expect(webSteps.length).toBeGreaterThan(5);
    expect(checkSteps.length).toBeGreaterThan(8);
    expect(images.length).toBeGreaterThan(2);
    expect(secretScan.length).toBeGreaterThan(1);
  });

  it('runs every job on a runner image named by its version, never a moving -latest label (IN-48)', () => {
    const labels = [...text.matchAll(/^\s+runs-on:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    expect(labels).toHaveLength(5);
    for (const label of labels) {
      expect(label).not.toMatch(/-latest$/);
      expect(label).toMatch(/^ubuntu-\d{2}\.\d{2}$/);
    }
    expect(new Set(labels).size).toBe(1);
  });

  it('cancels a superseded run of a branch but never one on main, so the scan of a push is not dropped by the next push (IN-55)', () => {
    expect(text).toMatch(/cancel-in-progress:\s*\$\{\{\s*github\.ref != 'refs\/heads\/main'\s*\}\}/);
    expect(text).not.toMatch(/cancel-in-progress:\s*true/);
  });

  it('gives each push to main a group of its own: GitHub drops a waiting run when another arrives in its group, cancel-in-progress or not (IN-55)', () => {
    expect(text).toMatch(/group:\s*ci-\$\{\{\s*github\.ref == 'refs\/heads\/main' && github\.sha \|\| github\.ref\s*\}\}/);
    expect(text).not.toMatch(/group:\s*ci-\$\{\{\s*github\.ref\s*\}\}\s*$/m);
  });

  it('names the parity step for what it does in CI, which is to run the checker\'s own checks and compare nothing (IN-55)', () => {
    const step = checkSteps.find((s) => s.run?.includes('parity.check.mjs'));
    expect(step?.name).toBeDefined();
    expect(step!.name).not.toMatch(/two copies match/i);
    expect(step!.name).toMatch(/own checks/i);
  });

  it('runs on pushes and pull requests to main', () => {
    const on = block(/^on:\s*$/, 0);
    expect(Object.keys(on)).toEqual(expect.arrayContaining(['push', 'pull_request']));
    expect(text).toMatch(/pull_request:\s*\n\s+branches: \[main\]/);
  });

  describe('permissions (SC-17)', () => {
    it('gives the token read access to the repository and nothing else', () => {
      expect(block(/^permissions:\s*$/, 0)).toEqual({ contents: 'read' });
    });

    it('lets no job ask for more than that', () => {
      for (const [name, job] of Object.entries(jobs)) expect(job.permissions, name).toEqual({});
    });

    it('never pushes, deploys or signs in anywhere', () => {
      for (const s of all) expect(s.run ?? '', s.name).not.toMatch(/\b(?:docker\s+(?:push|login)|git\s+push|gh\s|npm\s+publish)/);
    });

    it('pins every action to a full commit SHA and names the tag it was taken from, so a moved tag cannot change what runs', () => {
      const lines = text.split('\n').filter((l) => /^\s*(?:- )?uses:/.test(l));
      // Read off the file as written, comments included: the tag after the SHA is what a person checks.
      expect(lines.length).toBeGreaterThan(4);
      for (const l of lines) expect(l.trim(), l).toMatch(/^(?:- )?uses:\s+[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+# v\d+\.\d+\.\d+$/);
      // The steps the reader found are those lines, so none was skipped for being written another way.
      expect(all.filter((s) => s.uses).length).toBe(lines.length);
    });
  });

  describe('the secret scan (SC-17, SC-06)', () => {
    const job = text.slice(text.indexOf('\n  secrets:'), text.indexOf('\n  images:'));

    it('runs on pushes and pull requests, and not on a manual run, which has no commit range and would read all history', () => {
      expect(job).toMatch(/\n {4}if: github\.event_name != 'workflow_dispatch'\n/);
    });

    it('checks out the whole history, which is what a scan of a range of commits needs', () => {
      expect(job).toMatch(/uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+fetch-depth: 0\n/);
    });

    it('scans with gitleaks, and publishes nothing a finding could be read from', () => {
      expect(secretScan.some((s) => /^gitleaks\/gitleaks-action@[0-9a-f]{40}$/.test(s.uses ?? ''))).toBe(true);
      // On a public repository a comment or an artifact would repeat the secret it found.
      expect(job).toMatch(/GITLEAKS_ENABLE_COMMENTS: false/);
      expect(job).toMatch(/GITLEAKS_ENABLE_UPLOAD_ARTIFACT: false/);
    });
  });

  describe('the checks the checklist asked for (IN-10)', () => {
    it.each([
      ['server', serverSteps],
      ['web', webSteps],
    ] as const)('installs from the lockfile, audits, typechecks and tests %s', (dir, steps) => {
      expect(runs(steps, 'npm ci', dir)).toBe(true);
      expect(runs(steps, 'npm audit --omit=dev --audit-level=high', dir)).toBe(true);
      expect(runs(steps, 'npm run typecheck', dir)).toBe(true);
      expect(runs(steps, 'npm test', dir)).toBe(true);
    });

    it('builds the server and the web app, and lints both; the web build also typechecks vite.config.ts', () => {
      expect(runs(serverSteps, 'npm run build', 'server')).toBe(true);
      expect(runs(serverSteps, 'npm run lint', 'server')).toBe(true);
      expect(runs(webSteps, 'npm run lint', 'web')).toBe(true);
      expect(runs(webSteps, 'npm run build', 'web')).toBe(true);
    });

    it('gives the checks job the server dependencies, which hold the tsx that runs the TypeScript checkers', () => {
      expect(runs(checkSteps, 'npm ci', 'server')).toBe(true);
    });

    it.each(CHECKERS)('runs %s', (script) => {
      expect(runs(checkSteps, new RegExp(`\\s${script.replace(/\./g, '\\.')}(\\s|$)`))).toBe(true);
    });

    it('lists the same checkers in package.json, so `npm run check` is what CI runs', () => {
      const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8')).scripts as Record<string, string>;
      const named = Object.entries(pkg).filter(([key]) => key.startsWith('check:')).map(([, value]) => value).join(' && ');
      for (const script of CHECKERS) expect(named, script).toContain(script);
      // And nothing else: a checker added to one place and not the other is the drift this guards.
      const found = [...named.matchAll(/\b((?:tools\/check|web\/scripts)\/[\w.-]+)/g)].map((m) => m[1]);
      expect([...new Set(found)].sort()).toEqual([...CHECKERS].sort());
      expect(pkg.check).toBe(Object.keys(pkg).filter((key) => key.startsWith('check:')).map((key) => `npm run ${key}`).join(' && '));
    });

    it('builds both Docker images without pushing them, and checks the nginx config in the web one', () => {
      expect(runs(images, /^docker build --tag \S+ server$/)).toBe(true);
      const web = images.find((s) => /^docker build --tag \S+ web$/.test(s.run ?? ''));
      expect(web).toBeDefined();
      const tag = /--tag (\S+)/.exec(web?.run ?? '')?.[1] ?? '';
      expect(runs(images, `docker run --rm ${tag} nginx -t`)).toBe(true);
    });
  });

  describe('what its steps point at', () => {
    it('only names directories that exist, with a lockfile where it runs `npm ci`', () => {
      for (const s of all) {
        const dir = s['working-directory'];
        if (dir) expect(existsSync(root(dir)), `${s.name}: ${dir}`).toBe(true);
        if (s.run === 'npm ci') expect(existsSync(root(`${dir}/package-lock.json`)), s.name).toBe(true);
      }
    });

    it('caches npm by the lockfile of the folder it installs, and no other', () => {
      for (const job of [jobs.server, jobs.web, jobs.checks]) {
        const setup = job.steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
        expect(setup).toBeDefined();
      }
      const caches = [...text.matchAll(/cache-dependency-path: (\S+)/g)].map((m) => m[1]);
      expect(caches.sort()).toEqual(['server/package-lock.json', 'server/package-lock.json', 'web/package-lock.json']);
      for (const path of caches) expect(existsSync(root(path)), path).toBe(true);
    });

    it('only runs npm scripts that the package defines', () => {
      for (const s of all) {
        const m = /^npm (?:run (\S+)|(test))$/.exec(s.run ?? '');
        if (!m) continue;
        const scripts = JSON.parse(readFileSync(root(`${s['working-directory']}/package.json`), 'utf8')).scripts;
        expect(Object.keys(scripts), `${s.name}: ${s.run}`).toContain(m[1] ?? m[2]);
      }
    });

    it('only runs scripts that exist', () => {
      for (const s of all) {
        for (const m of (s.run ?? '').matchAll(/\b((?:server|web)\/scripts\/[\w.-]+|tools\/(?:check|live)\/[\w.-]+)/g)) {
          expect(existsSync(root(m[1])), `${s.name}: ${m[1]}`).toBe(true);
        }
      }
    });

    it('builds each image from a folder that holds its Dockerfile', () => {
      for (const s of images) {
        const m = /^docker build --tag \S+ (\S+)$/.exec(s.run ?? '');
        if (m) expect(existsSync(root(`${m[1]}/Dockerfile`)), s.name).toBe(true);
      }
    });
  });
});

describe('.github/dependabot.yml (SC-17, SC-21)', () => {
  const file = readFileSync(root('.github/dependabot.yml'), 'utf8');
  const entries = [...file.matchAll(/- package-ecosystem: (\S+)\n\s+directory: (\S+)/g)].map((m) => `${m[1]} ${m[2]}`);

  it('is version 2 and covers the actions, both npm projects and both Dockerfiles', () => {
    expect(file).toMatch(/^version: 2$/m);
    expect(entries.sort()).toEqual(['docker /server', 'docker /web', 'github-actions /', 'npm /server', 'npm /web']);
  });

  it('points only at folders that hold what its ecosystem reads', () => {
    for (const entry of entries) {
      const [kind, dir] = entry.split(' ');
      const where = dir === '/' ? '' : dir.slice(1);
      if (kind === 'npm') expect(existsSync(root(`${where}/package.json`)), entry).toBe(true);
      if (kind === 'docker') expect(existsSync(root(`${where}/Dockerfile`)), entry).toBe(true);
      if (kind === 'github-actions') expect(existsSync(root('.github/workflows')), entry).toBe(true);
    }
  });

  it('looks every week, so a pinned SHA or digest is never left to age', () => {
    expect([...file.matchAll(/interval: weekly/g)].length).toBe(entries.length);
  });
});
