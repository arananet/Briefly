/**
 * CrawlerAgent — Headless Chromium web crawler backed by Cloudflare Browser Rendering.
 *
 * Holds a puppeteer Browser singleton for the lifetime of the Durable Object.
 * Renders fully JavaScript-driven pages before returning their HTML, enabling
 * reliable scraping of SPAs like Arena.ai and Futurepedia that can't be
 * scraped with plain fetch.
 *
 * Usage (from another agent via callAgent):
 *   const html = await callAgent<string>(stub, "/call/renderPage", {
 *     url: "https://arena.ai/leaderboard/text",
 *     waitFor: "table",
 *   });
 */

import puppeteer, { Browser } from "@cloudflare/puppeteer";
import { Agent, callable } from "agents";
import type { Env } from "../types";

interface CrawlerState {
  pagesRendered: number;
}

export class CrawlerAgent extends Agent<Env, CrawlerState> {
  initialState: CrawlerState = { pagesRendered: 0 };

  private _browser: Browser | null = null;

  /** Returns the shared browser, launching it if needed. */
  private async getBrowser(): Promise<Browser> {
    if (this._browser && this._browser.isConnected()) {
      return this._browser;
    }
    this._browser = await puppeteer.launch(this.env.BROWSER);
    return this._browser;
  }

  /**
   * Render a URL in headless Chromium and return the fully-resolved HTML.
   *
   * @param url      The page to render
   * @param waitFor  Optional CSS selector to wait for before capturing HTML.
   *                 Use "networkidle" to wait for all network activity to stop.
   * @param timeout  Max wait in ms (default 25 000)
   */
  @callable()
  async renderPage(opts: {
    url: string;
    waitFor?: string;
    timeout?: number;
  }): Promise<string> {
    const { url, waitFor, timeout = 25_000 } = opts;
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Mimic a real Chrome desktop browser
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/122.0.0.0 Safari/537.36"
      );
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      });

      // Navigate
      await page.goto(url, {
        waitUntil:
          waitFor === "networkidle" ? "networkidle0" : "domcontentloaded",
        timeout,
      });

      // Wait for a specific element if requested
      if (waitFor && waitFor !== "networkidle") {
        try {
          await page.waitForSelector(waitFor, { timeout: 8_000 });
        } catch {
          // Element didn't appear — return whatever was rendered
        }
      }

      const html = await page.content();
      this.setState({ pagesRendered: this.state.pagesRendered + 1 });
      return html;
    } finally {
      await page.close();
    }
  }

  /**
   * Render a page and evaluate a JS expression inside it,
   * returning the serialised result. Useful for extracting
   * structured data from window globals or __NEXT_DATA__.
   */
  @callable()
  async evaluatePage(opts: {
    url: string;
    expression: string;
    waitFor?: string;
    timeout?: number;
  }): Promise<string> {
    const { url, expression, waitFor, timeout = 25_000 } = opts;
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/122.0.0.0 Safari/537.36"
      );

      await page.goto(url, {
        waitUntil:
          waitFor === "networkidle" ? "networkidle0" : "domcontentloaded",
        timeout,
      });

      if (waitFor && waitFor !== "networkidle") {
        try {
          await page.waitForSelector(waitFor, { timeout: 8_000 });
        } catch {
          // Timeout OK — evaluate anyway
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const result = await page.evaluate(expression);
      return JSON.stringify(result);
    } finally {
      await page.close();
    }
  }

  /** Close the browser and release the session. */
  async onDestroy(): Promise<void> {
    if (this._browser) {
      await this._browser.close().catch(() => {});
      this._browser = null;
    }
  }
}
