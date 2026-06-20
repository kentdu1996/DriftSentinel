import { rndHex } from "@driftsentinel/core";

export interface HttpOpts {
  timeoutMs?: number;
  retries?: number;
  bearer?: string;
}

export interface HttpResult<T = unknown> {
  ok: boolean;
  status: number;
  body: T;
  error?: string;
}

// GEP-A2A protocol envelope (7 required top-level fields).
export function envelope(
  messageType: string,
  payload: Record<string, unknown>,
  senderId?: string,
): Record<string, unknown> {
  const env: Record<string, unknown> = {
    protocol: "gep-a2a",
    protocol_version: "1.0.0",
    message_type: messageType,
    message_id: `msg_${Date.now()}_${rndHex(8)}`,
    timestamp: new Date().toISOString(),
    payload,
  };
  if (senderId) env.sender_id = senderId;
  return env;
}

async function once<T>(
  url: string,
  method: string,
  body: unknown,
  opts: HttpOpts,
): Promise<HttpResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let parsed: T;
    const text = await res.text();
    try {
      parsed = text ? (JSON.parse(text) as T) : (undefined as T);
    } catch {
      parsed = text as unknown as T;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: undefined as T,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

// Request with exponential backoff (3 tries default). Retries on network error
// or 5xx; does not retry 4xx (client error — retrying won't help).
export async function request<T = unknown>(
  url: string,
  method: string,
  body: unknown,
  opts: HttpOpts = {},
): Promise<HttpResult<T>> {
  const retries = opts.retries ?? 3;
  let last: HttpResult<T> | undefined;
  for (let attempt = 0; attempt < retries; attempt++) {
    last = await once<T>(url, method, body, opts);
    if (last.ok) return last;
    if (last.status >= 400 && last.status < 500) return last; // no retry on 4xx
    if (attempt < retries - 1) {
      await sleep(2 ** attempt * 300);
    }
  }
  return last!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
