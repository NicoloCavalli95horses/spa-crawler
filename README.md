# SPA crawler

Web interface crawler that explores a site by **clicking**, not just by following links. For each site, it builds a `state → click → state` graph, where a *state* is a distinct UI configuration (page, open menu, modal, selected tab...).

Based on [Crawlee](https://crawlee.dev) and [Playwright](https://playwright.dev) (Chromium), written in TypeScript.

## Quick Start

```bash
npm install
npx playwright install chromium

# explores a single site
START_URL=https://example.com npm start

# same as above, with the browser window visible
HEADLESS=false npm start              

# explores the first N sites from the Tranco list
npm run tranco -- --top 10 --depth 2         

# tests (run with a real browser)
npm test                                    

# execute TS type check
npm run typecheck

```

Results are saved in `storage/` (see [Output](https://www.google.com/search?q=%23output)).

## How It Works

Exploration is a **Depth-First Search (DFS)** over UI states:

1. the page loads and waits until it is **stable**;
2. the state is **captured**: clickable elements, visible texts, URL → an ID (fingerprint);
3. for each unattempted clickable element: the starting state is **restored**,
a **click** is performed, it waits for stability, and the resulting state is captured;
4. the edge is added to the graph; if the state is new, it is saved and recursed upon.

The visit stops when reaching `maxDepth`, `maxStates`, or `maxDurationSecs`:
termination is guaranteed even on very rich UIs. An error on an element only costs its own branch.

### Main Components

| Module | Role |
| --- | --- |
| [src/core/DfsExplorer.ts](https://www.google.com/search?q=src/core/DfsExplorer.ts) | Exploration algorithm and limits. Depends only on the interfaces in [src/core/interfaces.ts](https://www.google.com/search?q=src/core/interfaces.ts). |
| [src/buildExplorer.ts](https://www.google.com/search?q=src/buildExplorer.ts) | Composition root: the single point that instantiates concrete classes. |
| [src/main.ts](https://www.google.com/search?q=src/main.ts) | Configures `PlaywrightCrawler` (browser, language, viewport, concurrency). |
| [src/browser/StabilityWaiter.ts](https://www.google.com/search?q=src/browser/StabilityWaiter.ts) | Waits for DOM, network, and finished animations to settle for `quietMs`. Ignores websockets, long-polling, and infinite animations. |
| [src/extraction/ClickableExtractor.ts](https://www.google.com/search?q=src/extraction/ClickableExtractor.ts) | Collects visible clickable elements and discards those in the `blocklist`. |
| [src/extraction/SelectorBuilder.ts](https://www.google.com/search?q=src/extraction/SelectorBuilder.ts) | Gives each element a stable ID: tag + rounded rectangle (+ text), never DOM IDs or classes. |
| [src/state/StateFingerprinter.ts](https://www.google.com/search?q=src/state/StateFingerprinter.ts) | State ID: hash of the sorted set of clickables, plus URL and texts if active. |
| [src/browser/StateNavigator.ts](https://www.google.com/search?q=src/browser/StateNavigator.ts) | Restores a state by reloading the root and replaying the click path. If the ID does not match, the UI is non-deterministic and the branch is skipped. |
| [src/browser/ActionExecutor.ts](https://www.google.com/search?q=src/browser/ActionExecutor.ts) | Clicks at the element's coordinates. Closes dialogs and popups, blocks navigation to other origins. |
| [src/state/StateStore.ts](https://www.google.com/search?q=src/state/StateStore.ts), [src/state/StateGraph.ts](https://www.google.com/search?q=src/state/StateGraph.ts) | Seen states, already explored (state, element) pairs, graph edges. |
| [scripts/tranco.ts](https://www.google.com/search?q=scripts/tranco.ts) | Runs the crawler on the first N domains from the [Tranco list](https://tranco-list.eu). |

### Design Choices

* **Identity without IDs or classes.** Framework-generated IDs and classes change on every load. Therefore, elements and states are identified by geometry and text. The viewport is fixed and Crawlee's random fingerprinting is disabled.
* **One Crawlee request per site.** All exploration for a site lives in a single request handler without retries: a retry would restart from scratch, duplicating states.
* **Isolated contexts.** Each site has its own incognito page, so cookies and storage do not mix. Multiple sites can run in parallel using `concurrency`.
* **Always in English.** The browser declares the `en-US` locale (both `navigator.language` and the `Accept-Language` header). Multilingual sites therefore respond in English, and saved texts remain comparable with the `blocklist`. Exceptions remain possible for sites that choose the language based on IP.

## Configuration

Everything is in [src/config.ts](https://www.google.com/search?q=src/config.ts). The most important settings:

| Key | Default | Description |
| --- | --- | --- |
| `startUrl` | `$START_URL` or `[https://example.com](https://example.com)` | Site to explore with `npm start`. Protocol is required. |
| `maxDepth` / `maxStates` / `maxDurationSecs` | `3` / `500` / `1800` | Exploration limits per site. |
| `concurrency` | `1` | Sites explored in parallel. |
| `viewport` | `1280×800` | Fixed: rectangles, and thus IDs, depend on it. |
| `stability` | `500 / 10000 / 3000 ms` | Required silence, maximum wait ceiling, threshold beyond which an open request is ignored. |
| `rectGridPx` | `4` | Rectangle rounding: absorbs small layout shifts. |
| `includeUrlInFingerprint` | `true` | Two routes with the same layout remain distinct states. |
| `text.inStateFingerprint` | `true` | Includes visible texts in the state ID. Should be disabled on pages with random content (carousels, recommendations). |
| `headless` | `true` | `HEADLESS=false` opens the browser window to watch the crawler in action. |
| `locale` | `en-US` | Language requested from sites. |
| `screenshots` | `false` | Saves a PNG of each state. Useful only for visually inspecting results. |
| `blocklist` | `logout, quit, delete` | Substrings (case-insensitive) of text, `aria-label`, or `href` of elements that should never be clicked. |

## Authentication (protected areas)

Optional. Credentials are sent with every HTTP request to the explored site and its subdomains (navigations, fetch/XHR, resources); requests to third-party domains never receive them. Set them through environment variables (so secrets stay out of the repo) or the `auth` field in [src/config.ts](src/config.ts):

```bash
AUTH_BEARER=eyJ... START_URL=https://www.busuu.com/dashboard/timeline/a1 npm start
AUTH_COOKIES='sid=abc; remember=1' npm start     # same format as the DevTools Cookie header
AUTH_HEADERS='{"X-Api-Key":"k"}' npm start      # any extra header; overrides AUTH_BEARER's Authorization
```

## Browser extension (Chrome)

The crawler can load an unpacked Chrome extension and call functions it exposes on `window` at the start or end of each site's analysis. Declare it in [src/config.ts](src/config.ts):

```ts
extension: {
  path: './extensions/rapidor',   // folder containing manifest.json
  calls: [
    { fn: '__RAPIDOR__init', when: 'start' },
    { fn: '__RAPIDOR__getData', when: 'end', args: [] },  // args optional
  ],
},
```

* `start`: before the first state is captured. `end`: after the last state (also when the exploration stops on an error), on the page as it was left by the last click.
* Return values (JSON-serializable, promises are awaited) are saved in `storage/key_value_stores/default/<site>--extension-<when>-<fn>.json`.
* The functions must live in the page's `MAIN` world: declare the content script with `"world": "MAIN"` in `manifest.json`, otherwise `window` does not see them.
* A missing function (waits up to `actionTimeoutMs`) or a failing call logs a warning and never stops the crawl.
* With an extension, each site gets its own Chromium with a temporary profile (isolation is the same as incognito, but memory use is higher). Headless uses Chromium's new headless mode (`npx playwright install chromium`).

## Output

Each analysis gets its own folder `storage/sites/<site>_<timestamp>/` (e.g. `google.com_2026-10-30T12-16-20`):

* `states.json`: JSON array with one record per state (ID, URL, depth, click path from the root, clickables, visible texts). It stays valid JSON while the crawl is running.
* `state-graph.json`: the graph, edges `{ from, to, action }`. Updated at every new state.
* `extension-end-<fn>.json`: result of the browser extension call (see above), written at the end.
* `state-<id>.png`: only when `screenshots` is enabled.

Crawlee's own bookkeeping (request queue, statistics) stays in `storage/{datasets,key_value_stores,request_queues}` and is cleared at the start of each run; `storage/sites/` is never cleared.

## Statistics daemon

```bash
npm run stats                    # refreshes every 5s, works while crawls are running
npm run stats -- --once          # single pass
npm run stats -- --interval 10 --dir storage/sites
```

Reads every folder in `storage/sites/` and writes `storage/sites/_stats.json` with a per-site row and the averages of: total states, total edges (all sites, including those still running) and `Potential IDOR reported` from the extension (only sites whose extension result is already there).

## Tranco List

```bash
npm run tranco -- --top 10 --depth 2 --max-states 30 --max-duration 300 --concurrency 2

# fixed list, for reproducible runs
npm run tranco -- --list-id PYK6J 

```

Options override the limits in `config.ts`; the rest of the configuration remains valid.
