/* Verifies the README's pricing table against training.linuxfoundation.org,
   then stamps the "verified" dates — in that order, and only if the check
   actually passed.

   This replaces an earlier script that just rewrote the date every night. That
   version made the README claim "prices verified as of <today>" when nothing
   had been checked, which is exactly the kind of unearned trust signal this
   repo argues against elsewhere ("Every row here is one I've personally
   verified... not copied from another aggregator"). A freshness date is only
   worth having if it can go stale, so this one refuses to move unless every
   row it covers matched a live price.

   Where the numbers come from: each certification page carries a GA4 ecommerce
   payload with a machine-readable {"price":445,"item_id":"CKA"} object. That's
   the same figure the page renders, and it survives markup changes far better
   than scraping a "$445" out of the DOM.

   Not covered, deliberately: the three bundle rows. They aren't sold from a
   /certification/ page with the same payload, so the README says in plain text
   that bundles are checked by hand rather than letting them ride along under a
   "verified" banner they haven't earned.

   Exit codes: 0 = every covered row matched (dates stamped if they moved),
   1 = a mismatch or a fetch failure, so the workflow goes red and the date
   stays where it was. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = path.join(ROOT, 'README.md');
const DISCOUNT = 0.30;
const UA = 'Mozilla/5.0 (compatible; rushabhshah.dev price verifier; +https://github.com/Iamrushabhshahh/linux-foundation-coupon)';

/* code → the certification's own page slug. Verified to resolve and expose a
   price payload; see the block comment above for why this is keyed by code
   rather than scraped from the README's link column. */
const SLUGS = {
  CKA: 'certified-kubernetes-administrator-cka',
  CKAD: 'certified-kubernetes-application-developer-ckad',
  CKS: 'certified-kubernetes-security-specialist',
  LFCS: 'linux-foundation-certified-sysadmin-lfcs',
  CNPE: 'certified-cloud-native-platform-engineer-cnpe',
  KCNA: 'kubernetes-cloud-native-associate',
  KCSA: 'kubernetes-and-cloud-native-security-associate-kcsa',
  LFCA: 'linux-foundation-certified-it-associate',
  PCA: 'prometheus-certified-associate',
  ICA: 'istio-certified-associate-ica',
  CCA: 'cilium-certified-associate-cca',
  CAPA: 'certified-argo-project-associate-capa',
  CGOA: 'certified-gitops-associate-cgoa',
  CBA: 'certified-backstage-associate-cba',
  OTCA: 'opentelemetry-certified-associate-otca',
  KCA: 'kyverno-certified-associate-kca',
  CNPA: 'certified-cloud-native-platform-engineering-associate-cnpa',
};

const money = (s) => Number(String(s).replace(/[$,]/g, ''));

/* The FinOps table is a second partner programme on a different platform, so
   it needs its own map and its own price regex. It used to sit in the README
   unverified next to a section boasting about verified pricing, which is
   exactly the gap this script exists to close. */
const FINOPS = {
  'FinOps Certified Practitioner (FOCP)': 'https://learn.finops.org/path/finops-certified-practitioner-self-paced',
  'FinOps Certified Engineer (FOCE)': 'https://learn.finops.org/path/finops-certified-engineer',
  'FinOps Certified FOCUS Analyst': 'https://learn.finops.org/finops-certified-focus-analyst-certification',
  'FinOps Certified: AI Value': 'https://learn.finops.org/path/certified-finops-for-ai',
  'FinOps Certified: Technology Value': 'https://learn.finops.org/path/technology-value',
};
const FINOPS_DISCOUNT = 0.20;

/* Reads the price rows straight out of the README so the table stays the single
   source of truth. Anything that isn't a "| CODE: Name |" row — the bundles,
   the role-mapping table, the sale archive — simply doesn't match and is left
   alone. */
function parseFinopsTable(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*(FinOps [^|]+?)\s*\|\s*\$([\d,]+)\s*\|\s*~\$([\d,]+)\s*\|/);
    if (m) rows.push({ name: m[1], list: money(m[2]), discounted: money(m[3]) });
  }
  return rows;
}

async function finopsPrice(name) {
  const url = FINOPS[name];
  if (!url) return { name, error: 'no URL mapped for this certification' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      // Anchored to the purchase control rather than any dollar sign on the
      // page, so a redesign fails loudly instead of grabbing a bundle price.
      const m = body.match(/Purchase\s*\|?\s*\$([\d,]+)/);
      if (!m) throw new Error('no purchase price found on the page');
      return { name, url, price: money(m[1]) };
    } catch (err) {
      if (attempt === 2) return { name, url, error: err.message };
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

function parseTable(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*([A-Z]{3,4}):\s*[^|]+\|\s*[^|]*\|\s*\$([\d,]+)\s*\|\s*~\$([\d,]+)\s*\|/);
    if (m) rows.push({ code: m[1], list: money(m[2]), discounted: money(m[3]), line });
  }
  return rows;
}

async function livePrice(code) {
  const slug = SLUGS[code];
  if (!slug) return { code, error: 'no slug mapped for this code' };
  const url = `https://training.linuxfoundation.org/certification/${slug}/`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      const m = body.match(/"price"\s*:\s*([\d.]+)\s*,\s*"item_id"\s*:\s*"([^"]+)"/)
             || body.match(/"item_id"\s*:\s*"([^"]+)"[^}]*?"price"\s*:\s*([\d.]+)/);
      if (!m) throw new Error('no price payload found on the page');
      const price = Number(/^[\d.]+$/.test(m[1]) ? m[1] : m[2]);
      if (!Number.isFinite(price) || price <= 0) throw new Error(`unusable price ${m[0]}`);
      return { code, url, price };
    } catch (err) {
      if (attempt === 2) return { code, url, error: err.message };
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

/* ---------- live-sale block ----------
   Same self-retiring contract the website uses. The block is rendered from
   sale.json into the SALE markers, and once `end` passes the region is emptied
   on the next daily run. Without this the README would keep a finished sale at
   the top of the page announcing itself as live, which is the exact failure
   visible on competing coupon repos right now. */
const SALE_FILE = path.join(ROOT, 'sale.json');
function renderSale(text) {
  let sale = null;
  try { sale = JSON.parse(fs.readFileSync(SALE_FILE, 'utf8')).sale; } catch { /* no sale file, treat as none */ }
  const live = sale && new Date() < new Date(sale.end);
  const codes = live ? sale.codes.map(c => `> ${c.what.charAt(0).toUpperCase() + c.what.slice(1)}:\n>\n> \`\`\`\n> ${c.code}\n> \`\`\``).join('\n>\n') : '';
  const bundles = live ? sale.bundles.map(b => `> - ${b.label}: [rushabhshah.dev/go/${b.slug}](https://rushabhshah.dev/go/${b.slug})`).join('\n') : '';
  const block = !live ? `
*No Linux Foundation sale is running right now, so \`RUSHABH30\` at 30% is the best available discount. This section fills itself back in automatically the day the next sale starts.*
` : `
## <img src="assets/live-badge.svg" alt="Live now" height="20" align="absmiddle"> Live now: beats RUSHABH30 while it lasts

[![${sale.bannerAlt}](${sale.banner})](${sale.landing})

> [!IMPORTANT]
> **${sale.name}:** ${sale.headline}, ends **${sale.advertisedEnd}**. I got the heads-up on this one directly from the Linux Foundation affiliate team, so it's not scraped from anywhere else.
>
${codes}
>
> [**Use them before they expire →**](${sale.landing})
>
> \`${sale.codes[sale.codes.length - 1].code}\` applies to the multi-exam bundles, which are already discounted before the code lands:
>
${bundles}
>
> I'm not quoting bundle percentages. Those pages don't publish a machine-readable price, so unlike the table below I can't verify them automatically, and I'd rather link you to the real number than invent one.
>
> Neither stacks with \`RUSHABH30\`, so use whichever is bigger. ${sale.terms}

${sale.dateCaveat}

Sale codes never stack with \`RUSHABH30\`. The rule is always: use whichever discount is bigger, right now. This section only shows a sale while it's genuinely running, so check the date above before assuming it still applies.
`;
  const status = live ? '**Currently live** — see the top of this page.' : 'Expired.';
  return text
    .replace(/(<!-- SALE:START -->)[\s\S]*?(<!-- SALE:END -->)/, (_m, o, c) => `${o}\n<!-- Rendered from sale.json by scripts/verify-prices.mjs. Do not hand-edit\n     between these markers. To run a new sale, edit sale.json. -->\n${block}${c}`)
    .replace(/(<!-- SALE-STATUS:START -->)[\s\S]*?(<!-- SALE-STATUS:END -->)/, (_m, o, c) => `${o}${status}${c}`);
}

const text = fs.readFileSync(README, 'utf8');
const rows = parseTable(text);
if (!rows.length) {
  console.error('✗ Could not parse any pricing rows out of README.md. Refusing to stamp.');
  process.exit(1);
}

const results = await Promise.all(rows.map(r => livePrice(r.code)));
const problems = [];

for (const row of rows) {
  const live = results.find(r => r.code === row.code);
  if (live.error) {
    problems.push(`${row.code}: could not verify (${live.error})`);
    continue;
  }
  if (live.price !== row.list) {
    problems.push(`${row.code}: README says $${row.list}, live page says $${live.price} — ${live.url}`);
    continue;
  }
  // The discounted column is arithmetic, not a fetched figure, but a typo there
  // is just as wrong on a page whose entire job is quoting the discounted price.
  const expected = Math.floor(row.list * (1 - DISCOUNT));
  if (Math.abs(row.discounted - expected) > 1) {
    problems.push(`${row.code}: discounted column says ~$${row.discounted}, 30% off $${row.list} is ~$${expected}`);
  }
}

const finRows = parseFinopsTable(text);
const finResults = await Promise.all(finRows.map(r => finopsPrice(r.name)));
for (const row of finRows) {
  const live = finResults.find(r => r.name === row.name);
  if (live.error) { problems.push(`${row.name}: could not verify (${live.error})`); continue; }
  if (live.price !== row.list) {
    problems.push(`${row.name}: README says $${row.list}, live page says $${live.price} — ${live.url}`);
    continue;
  }
  const expected = Math.floor(row.list * (1 - FINOPS_DISCOUNT));
  if (Math.abs(row.discounted - expected) > 1) {
    problems.push(`${row.name}: discounted column says ~$${row.discounted}, 20% off $${row.list} is ~$${expected}`);
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s); leaving the verified date untouched:\n`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error('\nFix the README (or the SLUGS map) and re-run. The date only moves on a clean pass.');
  process.exit(1);
}

const now = new Date();
const today = now.toISOString().slice(0, 10);
const longDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const monthYear = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });

const withSale = renderSale(text);
const stamped = withSale
  .replace(/\(Updated [A-Za-z]+ \d{4}\)/, `(Updated ${monthYear})`)
  .replace(/as of \*\*[A-Za-z]+ \d{1,2}, \d{4}\*\*/, `as of **${longDate}**`)
  .replace(/Pricing \(verified \d{4}-\d{2}-\d{2}\)/, `Pricing (verified ${today})`);

console.log(`✓ ${rows.length}/${rows.length} Linux Foundation and ${finRows.length}/${finRows.length} FinOps prices matched the live pages.`);
if (stamped !== text) {
  fs.writeFileSync(README, stamped);
  console.log(`✓ Stamped README with ${today}.`);
} else {
  console.log('✓ README already current, nothing to stamp.');
}
