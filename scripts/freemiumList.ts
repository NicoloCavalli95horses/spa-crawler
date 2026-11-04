/**
 * Lists the domains scripts/freemiumPrefilter.ts stored in SQLite, best candidates first
 * (React sites only, highest freemium score first).
 *
 *   npm run freemium-list                              # every React candidate with score >= 1, as a table
 *   npm run freemium-list -- --top 20                  # only the first 20
 *   npm run freemium-list -- --top 20 --format domains # one bare domain per line, e.g. to feed other tools
 *   npm run freemium-list -- --format json > candidates.json
 */
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { FreemiumCandidateStore } from '../src/db/FreemiumCandidateStore';
import { openDatabase } from '../src/db/openDatabase';
import { config } from '../src/config';

const { values: args } = parseArgs({
  options: {
    top: { type: 'string' },                          // omitted: all
    'min-score': { type: 'string', default: '1' },
    format: { type: 'string', default: 'table' },     // table | domains | json
    'include-non-react': { type: 'boolean', default: false },
    db: { type: 'string', default: config.db.path },
  },
});

function intArg({ name, value, min = 0 }: { name: string; value: string; min?: number }): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min}, not "${value}"`);
  return n;
}

const top = args.top === undefined ? Infinity : intArg({ name: 'top', value: args.top, min: 1 });
const minScore = intArg({ name: 'min-score', value: args['min-score']! });
if (!['table', 'domains', 'json'].includes(args.format!)) throw new Error(`--format must be one of table|domains|json, not "${args.format}"`);
if (!existsSync(args.db!)) throw new Error(`${args.db} does not exist: run npm run freemium-prefilter first`);

const store = new FreemiumCandidateStore({ db: openDatabase({ path: args.db! }), clearOnStart: false });
const rows = store.all()
  .filter((r) => (args['include-non-react'] || r.isReact) && r.score >= minScore && !r.error)
  .slice(0, top);

if (args.format === 'domains') {
  for (const r of rows) console.log(r.domain);
} else if (args.format === 'json') {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.table(rows.map((r) => ({
    domain: r.domain, rank: r.rank ?? '-', react: r.isReact ? r.reactEvidence.join(', ') : 'no', score: r.score,
    keywords: r.keywordHits.join(' | ') || '-', billing: r.billingScriptHits.join(', ') || '-',
  })));
  console.log(`${rows.length} shown`);
}
