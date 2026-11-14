// main.ts — token launch radar entry (Node 22+, standard library only, no network).
//
// Reads the sealed snapshot (--input <file|dir>, default /input/snapshot.json),
// ranks every pre-token protocol with the peer-ratio model in lib/model.ts, and
// writes into the output directory (MAKEFUN_OUTPUT_DIR, else /output):
//   board.json    the ranked board the gate checks
//   data.js       window.BOARD_DATA, the dashboard's whole dataset
//   dashboard/    this repository's static page, copied
//   screenshots/  this repository's screenshots, copied
//   dossier.json  buildDossier() from vendor/makefun-board.ts, written last so
//                 the scorer's rebuild from the same output matches byte for byte
//
// The run is deterministic: the same snapshot always produces the same bytes.
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildData, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input/snapshot.json');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const data = buildData(snapshot);
const issue = boardIssue(data.rows, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: refusing to write a board the gate rejects: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'board.json'),
  `${JSON.stringify({ as_of: data.as_of, source: data.source, floor_usd: data.floor_usd, model_version: data.model.version, rows: data.rows })}\n`,
);
writeFileSync(join(out, 'data.js'), dataScript(data));

/** Copy a directory's regular files into the output, skipping dotfiles. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3 or 4\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: names are letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${data.protocol_count} protocols (${data.pre_token_count} pre-token, ${data.tokenized_count} tokenized set apart), ` +
    `watchlist ${data.watchlist_size}/${data.watchlist_size} covered, ${data.board_size} rows, total implied $${data.total_implied_usd.toLocaleString('en-US')}\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images), dossier.json into ${out}\n`,
);
