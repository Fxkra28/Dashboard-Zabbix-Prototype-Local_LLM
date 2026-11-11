// docs/api/openapi.yaml as JSON, for the server's contract test, which has no YAML parser: `npm run gen:api` writes it
// beside openapi.ts, and src/__tests__/openapiTypes.test.ts fails when it is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The parser openapi-typescript reads the file with, so nothing is added to package.json.
const { parseYaml } = createRequire(createRequire(import.meta.url).resolve('openapi-typescript'))('@redocly/openapi-core');

/** The spec without `servers`, the one part the two copies of the portal differ in. */
function specJson(yamlText) {
  const spec = parseYaml(yamlText);
  delete spec.servers;
  return `${JSON.stringify(spec, null, 2)}\n`;
}

const source = fileURLToPath(new URL('../../docs/api/openapi.yaml', import.meta.url));
const out = fileURLToPath(new URL('../src/generated/openapi.json', import.meta.url));
writeFileSync(out, specJson(readFileSync(source, 'utf8')));
console.log('openapi-json: wrote src/generated/openapi.json');
