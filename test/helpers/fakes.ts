import type { Page } from 'playwright';
import { log } from 'crawlee';
import type {
  IActionExecutor, IStabilityWaiter, IStateCapturer,
} from '../../src/core/interfaces';
import type { Action, ElementDescriptor, Snapshot } from '../../src/core/types';

log.setLevel(log.LEVELS.OFF);   // no noise from the engine logs during tests

export function descriptor(id: string, extra: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return {
    id, selector: `#${id}`, tag: 'button', fixed: false, text: id,
    rect: { x: 0, y: 0, width: 10, height: 10 }, ...extra,
  };
}

/**
 * Simulated application: a state machine.
 * transitions[state][element] = target state; 'THROW' makes the executor throw an error.
 */
export class FakeApp {
  current: string;
  gotoCount = 0;
  clicks: string[] = [];

  constructor(public transitions: Record<string, Record<string, string>>, public root = 'S0') {
    this.current = root;
  }

  /** The bare minimum of Page that the engine uses on the fake page. */
  page(): Page {
    return {
      url: () => `https://app.test/#${this.current}`,
      goto: async () => { this.gotoCount++; this.current = this.root; return null; },
      screenshot: async () => Buffer.from('png'),
    } as unknown as Page;
  }

  capturer(): IStateCapturer {
    return {
      capture: async (): Promise<Snapshot> => ({
        id: this.current,
        url: `https://app.test/#${this.current}`,
        clickables: Object.keys(this.transitions[this.current] ?? {}).map((id) => descriptor(id)),
        texts: [],
      }),
    };
  }

  executor(): IActionExecutor {
    return {
      execute: async (_page: Page, action: Action) => {
        const next = this.transitions[this.current]?.[action.target.id];
        if (next === 'THROW') throw new Error(`boom on ${action.target.id}`);
        if (!next) return false;
        this.clicks.push(`${this.current}.${action.target.id}`);
        this.current = next;
        return true;
      },
    };
  }
}

export const noWait: IStabilityWaiter = { waitForStable: async () => {} };

/**
 * Several tabs on the same simulated app: each has its own current state, and every action yields
 * control (like a real click), so the tabs really interleave.
 */
export class FakeTabs {
  private apps: FakeApp[];
  private pagesList: Page[];
  private byPage = new Map<Page, FakeApp>();

  constructor(transitions: Record<string, Record<string, string>>, count: number) {
    this.apps = Array.from({ length: count }, () => new FakeApp(transitions));
    this.pagesList = this.apps.map((a) => a.page());
    this.pagesList.forEach((p, i) => this.byPage.set(p, this.apps[i]));
  }

  pages(): Page[] { return this.pagesList; }
  get clicks(): string[] { return this.apps.flatMap((a) => a.clicks); }
  get gotoCount(): number { return this.apps.reduce((n, a) => n + a.gotoCount, 0); }
  clicksOf(i: number): string[] { return this.apps[i].clicks; }

  capturer(): IStateCapturer {
    return { capture: async (page: Page) => this.byPage.get(page)!.capturer().capture(page) };
  }

  executor(): IActionExecutor {
    return {
      execute: async (page: Page, action: Action) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return this.byPage.get(page)!.executor().execute(page, action);
      },
    };
  }
}
