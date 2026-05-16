/* global console */
// One-shot helper. Runs the exporter against the basic-arb fixture with the
// A2 edit applied (pl.save = "Zapisz!") and writes the canonical output to
// `e2e/fixtures/expected/A2.pl.arb`. Re-run this if either the fixture or
// the ARB exporter changes; commit the regenerated golden.
//
//     pnpm --filter @polylocale/core build
//     node e2e/scripts/build-expected.mjs
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const coreEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'core',
  'dist',
  'index.js',
);
const { composeProject, exportArb, parseArb, parseICU } = await import(
  /* @vite-ignore */ `file://${coreEntry.replace(/\\/g, '/')}`
);

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, '..', 'fixtures', 'basic-arb');
const expectedDir = path.resolve(here, '..', 'fixtures', 'expected');

const enText = await fs.readFile(path.join(fixtureDir, 'en.arb'), 'utf8');
const plText = await fs.readFile(path.join(fixtureDir, 'pl.arb'), 'utf8');

const sources = [
  parseArb({ fileName: 'en.arb', text: enText }),
  parseArb({ fileName: 'pl.arb', text: plText }),
];

const project = composeProject({
  id: 'e2e-a2',
  name: 'basic-arb',
  baseLocale: 'en',
  sources,
});

const edited = {
  ...project,
  keys: project.keys.map((k) => {
    if (k.path !== 'save') return k;
    const next = { ...k.values };
    next.pl = {
      ir: parseICU('Zapisz!'),
      raw: 'Zapisz!',
      reviewed: true,
      modifiedAt: 0,
      source: 'manual',
    };
    return { ...k, values: next };
  }),
};

await fs.mkdir(expectedDir, { recursive: true });
await fs.writeFile(path.join(expectedDir, 'A2.pl.arb'), exportArb(edited, 'pl'), 'utf8');
await fs.writeFile(path.join(expectedDir, 'A2.en.arb'), exportArb(edited, 'en'), 'utf8');

console.log('wrote', path.join(expectedDir, 'A2.pl.arb'));
console.log('wrote', path.join(expectedDir, 'A2.en.arb'));
