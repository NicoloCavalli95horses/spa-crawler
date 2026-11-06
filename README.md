# SPA crawler

Web interface crawler that explores a site by **clicking**, not just by following links. For each site, it builds a `state → click → state` graph, where a *state* is a distinct UI configuration (page, open menu, modal, selected tab...).

Alongside exploration, it also detects **IDOR/BOLA vulnerabilities**: it loads RAPIDOR, a React DevTools extension, to capture React component state as it clicks around, correlates that state with the HTTP traffic it observes, and — entirely server-side, in this Node process — forges alternative requests (and, for SPA routes that never hit the network, replays the page's own client-side routing) to see whether a different user's data leaks out.

Based on [Crawlee](https://crawlee.dev) and [Playwright](https://playwright.dev) (Chromium), written in TypeScript.

## Quick Start

```bash
npm install
npx playwright install chromium

# explores a single site
START_URL=https://example.com npm start

# same as above, with the browser window visible
HEADLESS=false npm start

# log in by hand once, saving cookies/tokens into a persistent browser profile (see Authentication below)
USER_DATA_DIR=$HOME/.crawler-profile DEBUG_NO_CRAWLING=true HEADLESS=false npm start

# explores the first N sites from the Tranco list (or N sites from rank P with --start P)
npm run tranco -- --top 10 --depth 2
npm run tranco -- --start 50 --top 5

# crawl states/edges + IDOR findings + per-site stats from the last run(s), straight from SQLite
npm run stats

# tests (run with a real browser)
npm test

# execute TS type check
npm run typecheck
```

Everything the crawler produces — crawl states/edges, HTTP traffic, React state, IDOR findings, stats — lives in one SQLite file, `storage/crawler.db` — see [Output](#output).

## How It Works

Exploration is a **Depth-First Search (DFS)** over UI states:

1. the page loads and waits until it is **stable**;
2. the state is **captured**: clickable elements, visible texts, URL → an ID (fingerprint);
3. for each unattempted clickable element: the starting state is **restored**,
a **click** is performed, it waits for stability, and the resulting state is captured;
4. the edge is added to the graph; if the state is new, it is saved and recursed upon.

The visit stops when reaching `maxDepth`, `maxStates`, or `maxDurationSecs`:
termination is guaranteed even on very rich UIs. An error on an element only costs its own branch.

While this happens, three more things run unconditionally for every site (see [IDOR analysis](#idor-analysis-authzidor-detection)):

* **`NetworkObserver`** captures same-site `fetch`/XHR traffic directly via Playwright (`page.on('requestfinished'/'requestfailed')`), deduplicated into `http_events`.
* **`ReactStateHooks`** reads `window.__RAPIDOR__getLatestState()` (exposed by the RAPIDOR extension, see below) after each action and persists it into `react_states`, immediately re-indexing the interesting prop values it contains (`preindexed_values`). A repeated capture of the same `(url, fingerprint)` refreshes the stored graph (so the preindex never points at node IDs missing from it), and capture outcomes (captured / no graph / failed) are counted and logged. `AnalysisPipeline` warns when a crawled URL has no React state at all.
* **`AnalysisPipeline`** runs once per site, at the end of its exploration: for every captured HTTP event it looks for a sibling React component instance with a different value at the same prop path, forges the corresponding request, and flags+persists a vulnerability (`vulnerabilities`) when the response looks authorized and the differing props are themselves authorization-relevant.

### Main Components

| Module | Role |
| --- | --- |
| [src/core/DfsExplorer.ts](src/core/DfsExplorer.ts) | Exploration algorithm and limits. Depends only on the interfaces in [src/core/interfaces.ts](src/core/interfaces.ts). |
| [src/buildExplorer.ts](src/buildExplorer.ts) | Composition root: the single point that instantiates concrete classes. |
| [src/main.ts](src/main.ts) | Configures `PlaywrightCrawler` (browser, language, viewport, concurrency) and wires up the SQLite stores shared across the whole run. |
| [src/browser/StabilityWaiter.ts](src/browser/StabilityWaiter.ts) | Waits for DOM, network, and finished animations to settle for `quietMs`. Ignores websockets, long-polling, and infinite animations. |
| [src/extraction/ClickableExtractor.ts](src/extraction/ClickableExtractor.ts) | Collects visible clickable elements and discards those in the `blocklist`. Form fields (`input`/`select`/`textarea`) are never clickables, however they are detected (semantic selector, `onClick` prop, `cursor: pointer`): the crawler never fills forms, and this also avoids triggering a native file/date picker from inside a payment modal. |
| [src/browser/ActionExecutor.ts](src/browser/ActionExecutor.ts) | Clicks the target element; also guards every page against alert/confirm dialogs, popups, off-domain navigation, and downloads (cancelled, never written to disk — only logged, since the site under test is untrusted — the triggering request itself is still followed/analysed like any other). |
| [src/extraction/SelectorBuilder.ts](src/extraction/SelectorBuilder.ts) | Gives each element a stable ID: tag + rounded rectangle (+ text), never DOM IDs or classes. |
| [src/state/StateFingerprinter.ts](src/state/StateFingerprinter.ts) | State ID: hash of the sorted set of clickables, plus URL and texts if active. |
| [src/browser/StateNavigator.ts](src/browser/StateNavigator.ts) | Restores a state by reloading the root and replaying the click path. If the ID does not match, the UI is non-deterministic and the branch is skipped. |
| [src/browser/ActionExecutor.ts](src/browser/ActionExecutor.ts) | Clicks at the element's coordinates. Closes dialogs and popups, blocks navigation to other origins. |
| [src/state/StateStore.ts](src/state/StateStore.ts), [src/state/StateGraph.ts](src/state/StateGraph.ts) | Seen states (in-memory) and already explored (state, element) pairs; persist full records via [src/db/CrawlStateStore.ts](src/db/CrawlStateStore.ts)/[src/db/CrawlEdgeStore.ts](src/db/CrawlEdgeStore.ts). |
| [src/browser/NetworkObserver.ts](src/browser/NetworkObserver.ts) | Shadow capture of same-site HTTP traffic (see above), persisted via [src/db/HttpEventStore.ts](src/db/HttpEventStore.ts). |
| [src/browser/ReactStateHooks.ts](src/browser/ReactStateHooks.ts) | Reads and persists RAPIDOR's React state ([src/db/ReactStateStore.ts](src/db/ReactStateStore.ts)) and pre-indexes it ([src/db/PreindexedValueStore.ts](src/db/PreindexedValueStore.ts)). |
| [src/analysis/AnalysisPipeline.ts](src/analysis/AnalysisPipeline.ts) | The preindex → match → forge → evaluate chain; see [IDOR analysis](#idor-analysis-authzidor-detection). |
| [scripts/tranco.ts](scripts/tranco.ts) | Runs the crawler on N domains from the [Tranco list](https://tranco-list.eu), starting from rank P (`--start`, default 1). |
| [scripts/stats.ts](scripts/stats.ts) | Prints per-site crawl/IDOR stats, cross-site averages, and flagged findings from `storage/crawler.db`. |
| [src/analysis/reproductionScript.ts](src/analysis/reproductionScript.ts) | Generates a runnable `.repro.ts` for every flagged finding; see [Reproduction scripts](#reproduction-scripts). |
| `scripts/debug*.ts` | Manual validation scripts (not part of the pipeline): `debugPimsleurIdor` (headless vs headful, one phase per process), `debugClientRoutingFlakiness` (probe reliability), `debugBusuuIdor` (React-state capture, uses a dedicated `storage/debug-busuu.db`), `debugPermissions` (Chromium auto-denies camera/mic/geolocation/notifications). |
| [scripts/freemiumPrefilter.ts](scripts/freemiumPrefilter.ts), [scripts/freemiumList.ts](scripts/freemiumList.ts) | Triage of Tranco domains (React only, then paywall-like wording and billing scripts) and extraction of the result; see [Freemium prefilter](#freemium-prefilter). |

### Design Choices

* **Identity without IDs or classes.** Framework-generated IDs and classes change on every load. Therefore, elements and states are identified by geometry and text. The viewport is fixed and Crawlee's random fingerprinting is disabled.
* **One Crawlee request per site.** All exploration for a site lives in a single request handler without retries: a retry would restart from scratch, duplicating states.
* **Isolated contexts.** Each site has its own incognito page, so cookies and storage do not mix. Multiple sites can run in parallel using `concurrency`.
* **Several tabs per site.** With `tabsPerSite > 1` each tab runs its own depth-first search over the shared state store and graph. `markExplored` is synchronous, so the first tab to reach a (state, element) pair claims it; a tab that runs out of work picks up unexplored elements from other tabs' states. Exploration is therefore not deterministic. Tabs need the persistent browser context (as with the extension or a saved profile).
* **HTTP cache stays on.** Playwright's `page.route` disables Chromium's HTTP cache, so every restore would re-download all scripts and styles. External navigations are blocked through a CDP `Fetch` interception limited to documents instead, and the browser cache works as for a normal user.
* **Always in English.** The browser declares the `en-US` locale (both `navigator.language` and the `Accept-Language` header). Multilingual sites therefore respond in English, and saved texts remain comparable with the `blocklist`. Exceptions remain possible for sites that choose the language based on IP.
* **SQLite, not JSON, for everything the crawler produces.** Crawl states and edges (screenshots included, as BLOBs), captured HTTP events, React state, pre-indexed values, flagged vulnerabilities, per-site stats, and the authorization classifier's cache all live in one file, `storage/crawler.db`. It is the single source of truth: no artifact dump duplicates it, and later runs can query/average across sites trivially.

## Configuration

Everything is in [src/config.ts](src/config.ts). The most important settings:

| Key | Default | Description |
| --- | --- | --- |
| `startUrl` | `$START_URL` or `https://learn.pimsleur.com/MiniLearn` | Site to explore with `npm start`. Protocol is required. |
| `startUrls` | `$START_URLS` (comma- or newline-separated) or `[]` | Several sites explored in one `npm start` run. When empty, only `startUrl` is explored. |
| `maxDepth` / `maxStates` / `maxDurationSecs` | `2` / `500` / `1800` | Exploration limits. `maxStates` applies to each tab, `maxDurationSecs` to the whole site. |
| `concurrency` | `1` | Sites explored in parallel. |
| `tabsPerSite` | `5` | Tabs exploring the same site together (same browser context: cookies and storage are shared). Work is split automatically and a state is never saved twice. Keep in sync with RAPIDOR's own `maxStateSnapshots`. |
| `restoreDelayMs` | `150` | Minimum gap between two page reloads of the same site, across all its tabs. |
| `viewport` | `1920×1080` | Fixed: rectangles, and thus IDs, depend on it. |
| `stability` | `500 / 10000 / 3000 ms` | Required silence, maximum wait ceiling, threshold beyond which an open request is ignored. |
| `rectGridPx` | `4` | Rectangle rounding: absorbs small layout shifts. |
| `includeUrlInFingerprint` | `true` | Two routes with the same layout remain distinct states. |
| `text.inStateFingerprint` | `true` | Includes visible texts in the state ID. Should be disabled on pages with random content (carousels, recommendations). |
| `headless` | `true` | `HEADLESS=false` opens the browser window to watch the crawler in action. |
| `lightweight` | enabled while exploring | Cheaper browsing (`LIGHTWEIGHT=false` turns it off; never active with `DEBUG_NO_CRAWLING`): animations/transitions shortened to 1ms (kept, so modals still get their `animationend`), paint-only CSS dropped (shadows, filters, blur — geometry untouched, so fingerprints are unaffected), images/fonts/analytics not loaded, and scripts/stylesheets kept in an in-memory cache so restoring a state does not download them again (`cacheStaticAssets`; fetch/XHR and the page document always go to the server). |
| `locale` | `en-US` | Language requested from sites. |
| `screenshots` | `false` | Saves a PNG of each state. Useful only for visually inspecting results. |
| `blocklist` | `logout, log out, sign out, quit, delete` | Substrings (case-insensitive) of text, `aria-label`, or `href` of elements that should never be clicked. |
| `db.path` | `storage/crawler.db` | Shared SQLite file for the whole run — every table the crawler writes. |
| `db.clearOnStart` | `true` | Wipes `crawl_states`/`crawl_edges`/`http_events`/`react_states`/`preindexed_values`/`vulnerabilities`/`analysis_stats`/`ablation_vulnerabilities`/`ablation_stats`/`forged_requests` once at the start of the run. |
| `db.clearClassifierCache` | `false` | Wipes `authz_classifications` too. Off by default: a classification is a pure function of the key string, independent of site or run, so it is worth keeping forever. |
| `analysis.maxConcurrentRequests` / `analysis.timeBetweenRequestsMs` | `3` / `250` | Bound and pace forged requests. |
| `analysis.reportsDir` | `reports` | Where the reproduction script of each flagged finding is written (`<reportsDir>/<site>/<findingId>.repro.ts`, gitignored). |
| `analysis.clientRoutingProbe` | `3000 / 300 ms` | How long the client-side-routing probe (`checkClientSideRouting`/`checkClientSideRoutingForPath`) waits for a DOM mutation after a synthetic `pushState`+`popstate`, sized to match the rest of the pipeline's own settle windows rather than the much shorter 500/100ms it used to hardcode. |
| `analysis.ablationMode` | `false` (`$ABLATION_MODE`) | Runs the [ablation study](#ablation-study-http-json-only) alongside the main analysis. Off by default: it roughly doubles the forged-request traffic against the site under test. |

## Authentication (protected areas)

Log in **once by hand** into a persistent Chromium profile, and every later run reuses it:

```bash
# opens a real, visible browser on startUrl and waits for you to close it — log in there
USER_DATA_DIR=$HOME/.crawler-profile DEBUG_NO_CRAWLING=true HEADLESS=false START_URL=https://example.com/login npm start

# later runs just point at the same profile; cookies/local storage/tokens are already there
USER_DATA_DIR=$HOME/.crawler-profile START_URL=https://example.com/dashboard npm start
```

* `userDataDir` requires `concurrency: 1` (a profile cannot be shared between browsers running at once).
* Do not point it at the Chrome profile you actually use day-to-day: it gets locked, and Chrome 136+ forbids automating it anyway. Use a dedicated folder (or a copy of one).
* `debugNoCrawling: true` (`DEBUG_NO_CRAWLING=true`) skips exploration entirely: the browser opens on `startUrl` and stays open until you close it — exactly the window you need to log in by hand.

## Browser extension (RAPIDOR)

The crawler loads RAPIDOR's unpacked Chrome extension to read React component state as it explores. It runs in RAPIDOR's own `mode: 'minimal'` (set in its `config.js`): the extension only exposes `window.__RAPIDOR__getLatestState()` (Bridge + StateManager) — HTTP tracking and IDOR analysis both happen in this crawler instead (see [IDOR analysis](#idor-analysis-authzidor-detection)), not in the extension.

Declared in [src/config.ts](src/config.ts):

```ts
extension: {
  path: '../rapidor/packages/react-devtools-extensions/chrome/build/unpacked', // folder containing manifest.json
  calls: [
    // clears the extension's shared IndexedDB once, so a run on a persistent profile starts clean
    { fn: '__RAPIDOR__reset', when: 'start' },
    // before/after each click: force-settle so the crawler never reads a half-updated React tree
    { fn: '__RAPIDOR__waitToAction', when: 'before-action', args: [{ timeoutMs: 3000 }] },
    { fn: '__RAPIDOR__waitToAction', when: 'after-action', args: [{ timeoutMs: 8000 }] },
    // kept only to surface extension runtime errors to the crawler log
    { fn: '__RAPIDOR__getData', when: 'end' },
  ],
},
```

* `start`: before the first state is captured. `before-action`/`after-action`: around every click on a clickable element. `end`: after the last state (also when the exploration stops on an error), on the page as it was left by the last click.
* The functions must live in the page's `MAIN` world: declare the content script with `"world": "MAIN"` in `manifest.json`, otherwise `window` does not see them.
* A missing function (waits up to `actionTimeoutMs`) or a failing call logs a warning and never stops the crawl.
* With an extension, each site gets its own Chromium with a temporary profile (isolation is the same as incognito, but memory use is higher). Headless uses Chromium's new headless mode (`npx playwright install chromium`).
* After editing RAPIDOR's own source, rebuild it before the crawler picks it up: `cd ../rapidor/packages/react-devtools-extensions && NODE_ENV=development node ./chrome/build`.

## IDOR analysis (authz/IDOR detection)

1. **Preindex** ([src/analysis/preindex.ts](src/analysis/preindex.ts)) — every captured React node's props are walked for "interesting" values (short strings/numbers under keys like `id`, `user`, `role`, `owner`, ...) and tokenized into `preindexed_values`.
2. **Segment extraction** ([src/analysis/segments.ts](src/analysis/segments.ts)) — for each captured HTTP event, proposes several path segments and each query parameter as candidate "swap this value" targets. Path segments are the union of (a) every index that was ever the sole one differing from a previously seen path of the same shape, and (b) a trailing window of the last `ceil(segmentCount / 2)` segments (capped at 5), taken without any "looks like an id" test since ids are as often plain numbers as UUIDs. At most 5 path candidates are kept per URL.
3. **Match finding** ([src/analysis/matchFinder.ts](src/analysis/matchFinder.ts)) — if a candidate's value matches a pre-indexed one, looks up sibling instances of the *same React component* with a different value at the same prop path.
4. **Request forging** ([src/analysis/requestForge.ts](src/analysis/requestForge.ts)) — splices the sibling's value in and replays the request via Playwright's `page.request.fetch()` (reuses the browsing context's cookies, but — unlike the page's own `fetch`/XHR — never fires `page.on('request')`, so forged probes never pollute `http_events`).
5. **Response evaluation** ([src/analysis/responseEvaluate.ts](src/analysis/responseEvaluate.ts)) — the forged response is compared against the original (status/headers/body-shape similarity); if it still looks "authorized", the differing props are classified for authorization-relevance by a sentence-embedding model (`src/analysis/authzClassifier.ts`, `@huggingface/transformers`, cosine similarity against a few fixed "entitlement" concept sentences, cached in `authz_classifications` — see `db.clearClassifierCache` above).
6. **Client-side routing fallback** ([src/analysis/clientRouting.ts](src/analysis/clientRouting.ts)) — for a candidate whose forged request did not look like it leaked anything (e.g. the server correctly rejects it), also checks whether the page's own client-side routing honors the swapped value anyway: it navigates back to the page the original event happened on, mutates `window.location` (`pushState` + a synthetic `popstate`) and watches for a real DOM mutation, independent of any server response — this is how a purely client-routed authorization bug (the UI trusts a URL it never re-validates) gets caught even though no "wrong" request ever reaches the network. It works for both **query parameters** (`checkClientSideRouting`, which also hooks `URLSearchParams` to confirm the page actually read the new value) and **path segments** (`checkClientSideRoutingForPath`, DOM mutation only, since no single API tells whether a router read a path segment). Because the probe's rollback can leave a render in flight that pollutes the next probe on the shared page, a negative result is retried up to 3 times before being trusted.
   Candidates are also **seeded from the crawler's own visited page URLs**, not only from `http_events`: a value an SPA only ever reads client-side never shows up in any request, yet is still tested via the client-routing probe.
7. **History filter** — before any request or probe, a candidate URL that the crawler already reached on its own (checked against the union of `http_events`, `react_states` and `crawl_states`) is skipped: swapping in a value the user can already reach by clicking around is not evidence of unauthorized access.

A flagged finding (`vulnerabilities` table) records which detection path caught it (`detectionMethod: 'http' | 'client-routing'`), the reference/candidate URLs, and a human-readable `motivation` (which props differ and how). Everything above — including every stat that used to only exist transiently (segments extracted, matches found, candidates found, HTTP events, React states, requests generated, vulnerabilities flagged) and the wall-clock time of the exploration and analysis phases (`exploration_ms`/`analysis_ms`, logged as `hh:mm:ss.mmm`) — is persisted per site in `analysis_stats`; inspect it with `npm run stats` (see [Statistics](#statistics)).

### Reproduction scripts

Right after a genuinely new finding is recorded (by any of the three paths: forged HTTP request, client-routing on a query param, client-routing on a path segment), [src/analysis/reproductionScript.ts](src/analysis/reproductionScript.ts) writes a standalone `reports/<site>/<site>_<vulnType>_<timestamp>.repro.ts` (`vulnType` is `http`, `client-query`, or `client-path`; `timestamp` includes milliseconds, so concurrently-evaluated candidates never collide). It is self-contained — the original request/response and both nodes' React props are embedded in the file itself, so it never depends on `storage/crawler.db` (which a later crawl, `db.clearOnStart` being the default, wipes):

```bash
npx tsx reports/<site>/<site>_<vulnType>_<timestamp>.repro.ts
```

All three finding kinds go through the **same flow**: a real (non-headless) browser opens, navigates to the original URL/request and the mutated one, and a screenshot is taken of each — for an HTTP finding this means opening the reference and candidate URLs directly (skipped, with a message, for a non-`GET` method, which can't be replayed by opening a URL); for a client-routing finding, the mutation is `pushState`+`popstate`, no reload. The script then prints, in order:

1. the **original** request/response (http) or page (client-routing);
2. the **mutated** request/response (a live, fresh request) or page;
3. the two **screenshots** (`<baseName>.original.png`, `<baseName>.mutated.png`), each written next to the script as soon as it's taken;
4. the **image diff**, in its own section (`<baseName>.diff.png`, via `pixelmatch`/`pngjs`) with the changed-pixel count, percentage, and an explicit verdict line (falls back to a size-mismatch notice if the two screenshots aren't the same dimensions);
5. the **response-similarity verdict** (http) or `isUsingNewParams`/DOM-mutation verdict (client-routing);
6. the **React props** of the original node and of the node whose value was spliced into the mutated request/URL, plus the authorization-relevant differences and the keys the classifier flagged.

A failure while generating a script never prevents the finding itself from being recorded.

### Ablation study (HTTP-JSON-only)

`analysis.ablationMode` (default `false`, `ABLATION_MODE=true` to turn it on) runs a second, independent analysis pass — [src/analysis/AblationPipeline.ts](src/analysis/AblationPipeline.ts) — alongside the main one, to measure how much of what the React-informed pipeline finds actually required React state at all, versus how much was sitting in plain sight in the JSON the site's own API already returned. No new network monitoring and no new exploration: it reuses the exact same `http_events`/`crawl_states` the main pipeline already captured.

* **Preindex** ([src/analysis/jsonMatchFinder.ts](src/analysis/jsonMatchFinder.ts), `buildJsonPreindex`) — every already-captured JSON response body for the site is walked once (same depth cap and "interesting key" rules as the React preindex — `isInteresting`/`tokenize` are reused verbatim), building a `value -> {body, path}[]` index. A URL segment is then looked up against the *whole* corpus, not just "its own" response: the id a request's own URL carries is often only ever *returned*, alongside its siblings, by a completely different endpoint (a list/listing call), not by the per-item endpoint whose own URL happens to contain it.
* **Sibling finding** (`findJsonCandidates`) — once a match lands inside some body, siblings are looked for at *every* enclosing array level along that match's path (not just the nearest one), each level varied independently while every other index stays fixed at its reference value — the JSON analog of `matchFinder.ts`'s `componentIndex` walk. Sibling-finding itself never crosses bodies: two different HTTP responses are never assumed to describe related data just because a value happens to appear in both.
* **Oracle** — identical to the main pipeline's HTTP path: forge the candidate request (`requestForge.ts`), compare the response (`responseEvaluate.ts`), diff the two sibling objects' properties (`compareObj`), classify the diff for authorization relevance (the same shared `authzClassifier.ts`, same cache). `compareObj` recurses index-wise into arrays (not just plain objects) for both pipelines, deliberately: the fairest ablation gives the HTTP-only analysis every tool the React-informed one has, so any remaining gap in what each pipeline flags reflects a real difference in signal (React state vs. JSON alone), not an avoidable blind spot shared by both.
* **Shared forged-request cache** ([src/db/ForgedRequestStore.ts](src/db/ForgedRequestStore.ts)) — keyed by `(site, method, url, body)`: if the main pipeline already forged the exact same candidate (the two often propose the same id swap from two different sources), the ablation reuses that response instead of hitting the live site again, and vice versa.
* **Structurally narrower by construction, not by omission** — there is no equivalent of the client-routing probes: those resolve their oracle from a DOM-mutation signal (did the app's own rendering react?), which has no network counterpart at all. A query param or path segment an SPA only ever reads client-side is invisible to a network-only analysis, full stop.

Findings land in their own tables — `ablation_vulnerabilities`/`ablation_stats` — never mixed with `vulnerabilities`/`analysis_stats`, so the two are always comparable:

```bash
ABLATION_MODE=true START_URL=https://example.com npm start
npm run compare-ablation                               # side-by-side stats + which findings the main pipeline caught that the ablation missed, by detectionMethod
npm run compare-ablation -- --db storage/other-run.db
```

### Test fixture: `react-app-target/`

A small Next.js app with two deliberately planted IDORs, used to prove detection end-to-end rather than just unit-testing each module in isolation:

* a **server-side** one — `/api/detail/:id` and the `/detail/:id` page it backs have no authorization check at all;
* a **client-side-routing** one — a `resourceId` query parameter is checked server-side on the normal click path (`/api/preview?resourceId=`, which correctly 403s on a premium resource), but a separate effect renders whatever ends up in that query string straight from the unguarded detail endpoint, so a crafted URL bypasses the check entirely.

```bash
cd react-app-target && node server.js   # builds (if needed) and serves everything on :3000, API included
# in another terminal, from the repo root:
START_URL=http://localhost:3000 npm start
npm run stats   # both IDORs should show up, one per detectionMethod
```

## Output

Everything the crawler produces lives in one SQLite file, `db.path` (default `storage/crawler.db`) — there are no JSON artifacts anywhere, and nothing else to look at:

* `crawl_states` — one row per distinct UI state (id, URL, depth, click path, clickables, visible texts), keyed by `(site, id)`. The screenshot, when `screenshots` is enabled, is a BLOB column on the same row rather than a separate file.
* `crawl_edges` — the click graph: one row per edge (`from`, `to`, action type/target/text/selector).
* `http_events`, `react_states`, `preindexed_values`, `vulnerabilities`, `analysis_stats`, `authz_classifications` — everything from [IDOR analysis](#idor-analysis-authzidor-detection).
* `ablation_vulnerabilities`, `ablation_stats` — the [ablation study](#ablation-study-http-json-only)'s own findings/stats, only ever written when `analysis.ablationMode` is on. `forged_requests` — the cache shared between the main pipeline and the ablation, so the same candidate is never forged twice.
* `freemium_candidates` — the [Freemium prefilter](#freemium-prefilter) results. Unlike the tables above it is **never** wiped by `db.clearOnStart`: crawler runs do not touch it, and re-checking a domain only overwrites that domain's row.

The only files written outside the database are the generated [reproduction scripts](#reproduction-scripts) under `analysis.reportsDir` (`reports/`).

Crawlee's own bookkeeping (request queue, key-value store) stays separate, under `storage/{datasets,key_value_stores,request_queues}`, and is cleared at the start of each run.

## Statistics

```bash
npm run stats                              # per-site crawl + IDOR stats, cross-site averages, flagged vulnerabilities
npm run stats -- --db storage/other-run.db # or any other SQLite file in that shape
```

`npm run compare-ablation` (same `--db` flag) compares these against the [ablation study](#ablation-study-http-json-only)'s own tables, when `analysis.ablationMode` was on for that run.

## Freemium study

`npm run tranco` runs the full crawler on Tranco sites

## Tranco List

```bash
npm run tranco -- --top 10 --depth 2 --max-states 30 --max-duration 300 --concurrency 2

# 5 sites starting from rank 50 (ranks 50..54)
npm run tranco -- --start 50 --top 5

# fixed list, for reproducible runs
npm run tranco -- --list-id PYK6J
```

`--top` is the number of sites, `--start` the Tranco rank of the first one (default `1`). Each site's logs are prefixed with its position in the run and its rank, e.g. `[2/5] #51 Exploring example.com (https://example.com/)`.

Options override the limits in `config.ts`; the rest of the configuration remains valid.
