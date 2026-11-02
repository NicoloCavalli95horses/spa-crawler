import type { Page } from 'playwright';
import type {
  IStateNavigator, IActionExecutor, IStabilityWaiter, IStateCapturer,
} from '../core/interfaces';
import type { UIState } from '../core/types';

export class StateNavigator implements IStateNavigator {
  constructor(
    private rootUrl: string,
    private executor: IActionExecutor,
    private waiter: IStabilityWaiter,
    private capturer: IStateCapturer,
    private throttle?: { wait(): Promise<void> },   // spaces out reloads of the same site
  ) {}

  async restore(page: Page, target: UIState): Promise<boolean> {
    if ((await this.currentId(page)) === target.id) return true;  // already there

    await this.throttle?.wait();
    await page.goto(this.rootUrl);                // refresh
    await this.waiter.waitForStable(page);
    for (const a of target.path) {               // replay the path
      if (!(await this.executor.execute(page, a))) return false;
      await this.waiter.waitForStable(page);
    }
    return (await this.currentId(page)) === target.id;  // false = non-deterministic UI
  }

  private async currentId(page: Page): Promise<string> {
    return (await this.capturer.capture(page)).id;
  }
}
