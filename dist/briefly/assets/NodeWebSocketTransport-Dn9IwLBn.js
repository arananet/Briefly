import { g as getDefaultExportFromCjs, p as packageVersion } from "./worker-entry-DAY2Ov7z.js";
import "node:events";
import "node:stream";
import "node:async_hooks";
import "cloudflare:workers";
import "node:diagnostics_channel";
import "node:buffer";
var browser;
var hasRequiredBrowser;
function requireBrowser() {
  if (hasRequiredBrowser) return browser;
  hasRequiredBrowser = 1;
  browser = function() {
    throw new Error(
      "ws does not work in the browser. Browser clients must use the native WebSocket object"
    );
  };
  return browser;
}
var browserExports = requireBrowser();
const NodeWebSocket = /* @__PURE__ */ getDefaultExportFromCjs(browserExports);
/**
 * @license
 * Copyright 2018 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
class NodeWebSocketTransport {
  static create(url, headers) {
    return new Promise((resolve, reject) => {
      const ws = new NodeWebSocket(url, [], {
        followRedirects: true,
        perMessageDeflate: false,
        // @ts-expect-error https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketaddress-protocols-options
        allowSynchronousEvents: false,
        maxPayload: 256 * 1024 * 1024,
        // 256Mb
        headers: {
          "User-Agent": `Puppeteer ${packageVersion}`,
          ...headers
        }
      });
      ws.addEventListener("open", () => {
        return resolve(new NodeWebSocketTransport(ws));
      });
      ws.addEventListener("error", reject);
    });
  }
  #ws;
  onmessage;
  onclose;
  constructor(ws) {
    this.#ws = ws;
    this.#ws.addEventListener("message", (event) => {
      if (this.onmessage) {
        this.onmessage.call(null, event.data);
      }
    });
    this.#ws.addEventListener("close", () => {
      if (this.onclose) {
        this.onclose.call(null);
      }
    });
    this.#ws.addEventListener("error", () => {
    });
  }
  send(message) {
    this.#ws.send(message);
  }
  close() {
    this.#ws.close();
  }
}
export {
  NodeWebSocketTransport
};
