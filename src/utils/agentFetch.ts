/**
 * Internal DO-to-DO fetch helper.
 * Adds the x-partykit-room header required by the partyserver base class
 * when making direct stub calls (bypassing routeAgentRequest).
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
    if (!res.ok) return [];
    const text = await res.text();
    // Guard against HTML error pages from Cloudflare / unhandled DO exceptions
    if (text.trimStart().startsWith("<")) return [];
    return JSON.parse(text) as unknown[];
  } catch {
    return [];
  }
}
