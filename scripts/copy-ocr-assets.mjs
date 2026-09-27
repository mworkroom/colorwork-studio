import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'ocr');
mkdirSync(target, { recursive: true });
const assets = [
  ['tesseract.js', 'dist', 'worker.min.js'],
  ['tesseract.js-core', 'tesseract-core-lstm.wasm.js'],
  ['@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'],
];
for (const parts of assets) {
  const name = parts.at(-1);
  copyFileSync(join(root, 'node_modules', ...parts), join(target, name));
}
