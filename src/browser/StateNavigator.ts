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
  ) {}

  async restore(page: Page, target: UIState): Promise<boolean> {
    if ((await this.currentId(page)) === target.id) return true;  // già lì

    await page.goto(this.rootUrl);                // refresh
    await this.waiter.waitForStable(page);
    for (const a of target.path) {               // replay del percorso
      if (!(await this.executor.execute(page, a))) return false;
      await this.waiter.waitForStable(page);
    }
    return (await this.currentId(page)) === target.id;  // false = UI non deterministica
  }

  private async currentId(page: Page): Promise<string> {
    return (await this.capturer.capture(page)).id;
  }
}
