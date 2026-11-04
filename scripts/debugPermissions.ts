// Diagnostic: does the crawler's exact browser launch config auto-deny camera/mic/geolocation/
// notifications, or does an unanswered request just hang? Not committed.
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { extensionLaunchArgs } from '../src/browser/ExtensionCalls';
import { config as defaultConfig } from '../src/config';

const headless = process.env.HEADLESS !== 'false';
const userDataDir = process.env.USER_DATA_DIR
  ? path.resolve(process.env.USER_DATA_DIR.replace(/^\$HOME|^~/, os.homedir()))
  : path.join(os.homedir(), '.crawler-profile');

// Mirrors main.ts's persistentBrowserOptions exactly (extension always on in this project's config).
const context = await chromium.launchPersistentContext(userDataDir, {
  headless,
  channel: 'chromium',
  args: [...extensionLaunchArgs(defaultConfig.extension!)],
});
const page = context.pages()[0] ?? await context.newPage();
await page.goto('https://example.com', { waitUntil: 'load' });

async function probe(label: string, fn: string) {
  const result = await page.evaluate(`(async () => {
    try {
      const value = await Promise.race([
        (async () => { ${fn} })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMED_OUT_5s')), 5000)),
      ]);
      return { outcome: 'resolved', value: String(value) };
    } catch (err) {
      return { outcome: 'rejected', name: err?.name, message: String(err?.message ?? err) };
    }
  })()`);
  console.log(`[${label}]`, JSON.stringify(result));
}

console.log(`=== headless=${headless} ===`);
await probe('camera+mic (getUserMedia)', `
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  stream.getTracks().forEach(t => t.stop());
  return 'granted';
`);
await probe('geolocation', `
  return await new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(() => resolve('granted'), (err) => reject(err)));
`);
await probe('notifications', `
  const perm = await Notification.requestPermission();
  return perm;
`);
await probe('permissions.query(camera)', `
  const status = await navigator.permissions.query({ name: 'camera' });
  return status.state;
`);

await context.close();
process.exit(0);
