import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeadlessRenderer } from './headless-renderer';

// No browser and no network here: Playwright is replaced by fakes, to reach failures a
// real browser will not produce on demand. Renders in real Chromium are in
// e2e/tests/crawler.test.ts.

const launch = vi.hoisted(() => vi.fn());
vi.mock('playwright', () => ({ chromium: { launch } }));

let renderer: HeadlessRenderer | undefined;

afterEach(async () => {
  await renderer?.close();
  renderer = undefined;
  launch.mockReset();
});

/** A browser whose every context fails to open, which is enough to count launches. */
function fakeBrowserWithoutContexts() {
  const listeners: Record<string, () => void> = {};
  return {
    on: (event: string, listener: () => void) => (listeners[event] = listener),
    emit: (event: string) => listeners[event]?.(),
    newContext: () => Promise.reject(new Error('no context')),
    close: () => Promise.resolve(),
  };
}

describe('HeadlessRenderer browser lifetime', () => {
  it('launches again after a launch that failed', async () => {
    launch.mockRejectedValueOnce(new Error('launch failed')).mockResolvedValue(fakeBrowserWithoutContexts());
    renderer = new HeadlessRenderer();

    await expect(renderer.render('https://example.com/')).rejects.toThrow('launch failed');
    await expect(renderer.render('https://example.com/')).rejects.toThrow('no context');
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('shares one browser between renders, and replaces it once it has died', async () => {
    const browser = fakeBrowserWithoutContexts();
    launch.mockResolvedValue(browser);
    renderer = new HeadlessRenderer();

    await expect(renderer.render('https://example.com/')).rejects.toThrow('no context');
    await expect(renderer.render('https://example.com/')).rejects.toThrow('no context');
    expect(launch).toHaveBeenCalledTimes(1);

    browser.emit('disconnected');
    await expect(renderer.render('https://example.com/')).rejects.toThrow('no context');
    expect(launch).toHaveBeenCalledTimes(2);
  });
});

describe('HeadlessRenderer time limit', () => {
  it('abandons a page that stops answering, and closes its context', async () => {
    const never = new Promise<never>(() => undefined);
    const closeContext = vi.fn(() => Promise.resolve());
    const page = {
      route: () => Promise.resolve(),
      routeWebSocket: () => Promise.resolve(),
      goto: () => Promise.resolve({ status: () => 200, headers: () => ({}) }),
      waitForLoadState: () => Promise.resolve(),
      // A page whose script never yields: Playwright waits for it without limit.
      evaluate: () => never,
      content: () => never,
    };
    const context = { newPage: () => Promise.resolve(page), on: () => undefined, close: closeContext };
    launch.mockResolvedValue({ ...fakeBrowserWithoutContexts(), newContext: () => Promise.resolve(context) });
    renderer = new HeadlessRenderer({ timeoutMs: 20 });

    vi.useFakeTimers();
    try {
      const rendering = renderer.render('https://example.com/');
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(rendering).resolves.toMatchObject({ kind: 'failed', reason: 'timeout' });
      expect(closeContext).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
