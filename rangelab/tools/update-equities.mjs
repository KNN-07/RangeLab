import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the compiled build-equities executable.');
const generated = await mkdtemp(join(tmpdir(), 'rangelab-equity-'));
try {
  const table = join(generated, 'matchups.bin');
  execFileSync(resolve(executable), [table], { stdio: 'inherit' });
  const data = await readFile(table);
  const classes = 169;
  const equitySize = classes * (classes - 1);
  if (data.length !== 2 * classes * classes) throw new Error('Unexpected generated table length.');
  const filename = new URL('../dist/engine.js', import.meta.url);
  const source = await readFile(filename, 'utf8');
  const tables = { equitySample: data.subarray(0, equitySize), tieSample: data.subarray(equitySize) };
  let updated = source;
  for (const [name, block] of Object.entries(tables)) {
    const pattern = new RegExp("const " + name + " = '[A-Za-z0-9+/=]*';");
    if (!pattern.test(source)) throw new Error('Missing embedded table ' + name);
    updated = updated.replace(pattern, "const " + name + " = '" + block.toString('base64') + "';");
  }
  if (source !== updated) await writeFile(filename, updated);
  console.log(source === updated ? 'Embedded tables match the deterministic simulation.' : 'Updated embedded showdown tables.');
} finally {
  await rm(generated, { recursive: true, force: true });
}
