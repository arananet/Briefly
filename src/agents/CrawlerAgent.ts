/**
 * CrawlerAgent — Stealth headless Chromium backed by Cloudflare Browser Rendering.
 *
 * Acts as a real user rather than a bot:
 *   - Removes navigator.webdriver fingerprint
 *   - Sets realistic viewport, user-agent, and security headers
 *   - Waits for networkidle2 by default so SPA data fetches complete
 *   - Maintains a browser singleton for the DO lifetime
 *
 * Usage (from another agent via callAgent):
 *   const html = await callAgent<string>(stub, "/call/renderPage", { url, waitFor });
 *   const data = await callAgent<string>(stub, "/call/evaluatePage", { url, expression });
 */

import puppeteer, { Browser, Page } from "@cloudflare/puppeteer";
import { Agent, callable } from "agents";
import type { Env } from "../types";

interface CrawlerState {
  pagesRendered: number;
}

// Current Chrome on macOS — keep in sync with real Chrome release cadence
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/135.0.0.0 Safari/537.36";

const SEC_HEADERS: Record<string, string> = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Ch-Ua": '"Google Chrome";v="135", "Chromium";v="135", "Not?A_Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export class CrawlerAgent extends Agent<Env, CrawlerState> {
  initialState: CrawlerState = { pagesRendered: 0 };
  private _browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this._browser && this._browser.isConnected()) return this._browser;
    this._browser = await puppeteer.launch(this.env.BROWSER);
    return this._browser;
  }

  /** Apply stealth settings to a fresh page before navigation. */
  private async preparePage(page: Page): Promise<void> {
    // Remove webdriver fingerprint — key stealth technique
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // Stub chrome runtime so sites don't detect headless
      (window as unknown as Record<string, unknown>).chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
      };
    });

    // Realistic desktop viewport
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders(SEC_HEADERS);
  }

  /**
   * Render a URL with full JS execution and return the page HTML.
   *
   * @param url     Page to render
   * @param waitFor CSS selector to wait for, or "networkidle" to wait for network quiet
   * @param timeout Max ms to wait (default 28 000)
   */
  @callable()
  async renderPage(opts: { url: string; waitFor?: string; timeout?: number }): Promise<string> {
    const { url, waitFor, timeout = 28_000 } = opts;
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await this.preparePage(page);

      // networkidle2 = ≤2 open connections for 500 ms — ideal for SPAs
      const waitUntil =
        waitFor === "networkidle" ? "networkidle0" : "networkidle2";

      await page.goto(url, { waitUntil, timeout });

      if (waitFor && waitFor !== "networkidle") {
        await page.waitForSelector(waitFor, { timeout: 8_000 }).catch(() => {});
      }

      const html = await page.content();
      this.setState({ pagesRendered: this.state.pagesRendered + 1 });
      return html;
    } finally {
      await page.close();
    }
  }

  /**
   * Render a page and evaluate a JS expression inside it.
   * Returns JSON.stringify of the expression result.
   *
   * Useful for extracting structured data directly:
   *   expression: "window.__NEXT_DATA__ || null"
   */
  @callable()
  async evaluatePage(opts: {
    url: string;
    expression: string;
    waitFor?: string;
    timeout?: number;
  }): Promise<string> {
    const { url, expression, waitFor, timeout = 28_000 } = opts;
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await this.preparePage(page);

      const waitUntil =
        waitFor === "networkidle" ? "networkidle0" : "networkidle2";

      await page.goto(url, { waitUntil, timeout });

      if (waitFor && waitFor !== "networkidle") {
        await page.waitForSelector(waitFor, { timeout: 8_000 }).catch(() => {});
      }

      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const result = await page.evaluate(expression);
      this.setState({ pagesRendered: this.state.pagesRendered + 1 });
      return JSON.stringify(result);
    } finally {
      await page.close();
    }
  }

  async onDestroy(): Promise<void> {
    if (this._browser) {
      await this._browser.close().catch(() => {});
      this._browser = null;
    }
  }
}
