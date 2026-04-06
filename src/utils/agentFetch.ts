/**
 * Internal DO-to-DO fetch helper.
 * Adds the x-partykit-room header required by the partyserver base class
 * when making direct stub calls (bypassing routeAgentRequest).
 *
 * Returns [] on any failure — callers treat empty as "not yet available".
 * Enable verbose mode to surface errors in the scraper-status endpoint.
 */
export async function agentFetch(
  stub: DurableObjectStub,
  path: string,
  body: unknown,
  room = "global"
): Promise<unknown[]> {
  try {
    const res = await stub.fetch(
      new Request(`https://internal${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-partykit-room": room,
        },
        body: JSON.stringify(body),
      })
    );

    if (!res.ok) {
      console.error(`[agentFetch] ${path} → HTTP ${res.status}`);
      return [];
    }

    const text = await res.text();

    // Guard against HTML error pages (Cloudflare / unhandled DO exceptions)
    if (text.trimStart().startsWith("<")) {
      console.error(`[agentFetch] ${path} → received HTML (DO error page)`);
      return [];
    }

    if (!text) return [];

    return JSON.parse(text) as unknown[];
  } catch (e) {
    console.error(`[agentFetch] ${path} → error:`, e);
    return [];
  }
}
