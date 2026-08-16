/* Stamps README.md with today's date wherever a "verified" date appears.
   Run daily by .github/workflows/verify.yml — the freshness signal is the
   whole point (see the "Why an evergreen code" section), so it has to be
   real and automated, not a date someone forgets to bump by hand. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = path.join(ROOT, 'README.md');

const now = new Date();
const today = now.toISOString().slice(0, 10);
const monthYear = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });

let text = fs.readFileSync(README, 'utf8');
const before = text;

text = text
  .replace(/\(Updated [A-Za-z]+ \d{4}\)/, `(Updated ${monthYear})`)
  .replace(/as of \*\*[A-Za-z]+ \d{1,2}, \d{4}\*\*/, `as of **${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}**`)
  .replace(/Pricing \(verified \d{4}-\d{2}-\d{2}\)/, `Pricing (verified ${today})`);

if (text !== before) {
  fs.writeFileSync(README, text);
  console.log(`Stamped README with ${today}`);
} else {
  console.log('README already current, no changes.');
}
