/**
 * Internal DO-to-DO call helpers.
 *
 * callAgent<T>  — generic; returns T | null on any failure
 * agentFetch    — backwards-compat wrapper that always returns unknown[]
 *
 * Both add the x-partykit-room header required by the partyserver base class.
 */

/** Generic agent callable helper — returns T or null on any failure. */
export async function callAgent<T>(
  stub: DurableObjectStub,
  path: string,
  body: unknown,
  room = "global"
): Promise<T | null> {
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
      console.error(`[callAgent] ${path} → HTTP ${res.status}`);
      return null;
    }

    const text = await res.text();

    if (!text) return null;

    // Guard against HTML error pages (Cloudflare / unhandled DO exceptions)
    if (text.trimStart().startsWith("<")) {
      console.error(`[callAgent] ${path} → received HTML (DO error page)`);
      return null;
    }

    return JSON.parse(text) as T;
  } catch (e) {
    console.error(`[callAgent] ${path} → error:`, e);
    return null;
  }
}

/** Backwards-compatible array wrapper — returns [] on any failure. */
export async function agentFetch(
  stub: DurableObjectStub,
  path: string,
  body: unknown,
  room = "global"
): Promise<unknown[]> {
  const result = await callAgent<unknown[]>(stub, path, body, room);
  return result ?? [];
}
