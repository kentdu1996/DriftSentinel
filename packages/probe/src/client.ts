import OpenAI from "openai";
import type {
  ChatMessage,
  ChatOpts,
  ChatResult,
  EndpointConfig,
  InjectConfig,
  TokenLogprob,
} from "@driftsentinel/core";
import { resolveApiKey } from "@driftsentinel/core";
import { MockClient } from "./mock.js";

const DEFAULT_TIMEOUT = 30_000;

export interface UnifiedClient {
  readonly endpoint: EndpointConfig;
  chat(messages: ChatMessage[], opts?: Partial<ChatOpts>): Promise<ChatResult>;
}

export function makeClient(
  endpoint: EndpointConfig,
  inject?: InjectConfig,
): UnifiedClient {
  if (endpoint.platform === "mock") {
    return new MockClient(endpoint, inject);
  }
  if (endpoint.platform === "anthropic") {
    return new AnthropicClient(endpoint, inject);
  }
  return new OpenAIClient(endpoint, inject);
}

// Demo degradation injection — applied at the client boundary only.
function applyInject(
  endpoint: EndpointConfig,
  opts: ChatOpts,
  inject?: InjectConfig,
): { model: string; extraLatencyMs: number; truncate: boolean } {
  if (!inject?.enabled || inject.target !== endpoint.id) {
    return { model: opts.model, extraLatencyMs: 0, truncate: false };
  }
  return {
    model: inject.mode === "swap_model" && inject.weakModel ? inject.weakModel : opts.model,
    extraLatencyMs: inject.mode === "add_latency" ? inject.latencyMs ?? 1500 : 0,
    truncate: inject.mode === "truncate",
  };
}

class OpenAIClient implements UnifiedClient {
  private sdk: OpenAI;
  constructor(
    readonly endpoint: EndpointConfig,
    private inject?: InjectConfig,
  ) {
    this.sdk = new OpenAI({
      apiKey: resolveApiKey(endpoint.apiKeyEnv),
      baseURL: endpoint.baseUrl,
    });
  }

  async chat(messages: ChatMessage[], opts: Partial<ChatOpts> = {}): Promise<ChatResult> {
    const merged: ChatOpts = {
      model: opts.model ?? this.endpoint.model,
      temperature: opts.temperature ?? 0,
      maxTokens: opts.maxTokens ?? 1024,
      logprobs: opts.logprobs ?? false,
      topLogprobs: opts.topLogprobs ?? 5,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT,
    };
    const inj = applyInject(this.endpoint, merged, this.inject);

    const start = Date.now();
    let firstTokenMs = 0;
    let text = "";
    let logprobs: TokenLogprob[] | undefined;

    const stream = await this.sdk.chat.completions.create(
      {
        model: inj.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: merged.temperature,
        max_tokens: merged.maxTokens,
        logprobs: merged.logprobs,
        top_logprobs: merged.logprobs ? merged.topLogprobs : undefined,
        stream: true,
        stream_options: { include_usage: true },
      },
      { timeout: merged.timeoutMs },
    );

    let usage: ChatResult["usage"];
    const collectedLp: TokenLogprob[] = [];
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        if (firstTokenMs === 0) firstTokenMs = Date.now() - start;
        text += delta;
      }
      const lp = chunk.choices[0]?.logprobs?.content;
      if (lp) {
        for (const t of lp) {
          collectedLp.push({
            token: t.token,
            logprob: t.logprob,
            topLogprobs: t.top_logprobs?.map((x) => ({
              token: x.token,
              logprob: x.logprob,
            })),
          });
        }
      }
      if (chunk.usage) {
        usage = {
          prompt: chunk.usage.prompt_tokens,
          completion: chunk.usage.completion_tokens,
        };
      }
    }
    if (collectedLp.length) logprobs = collectedLp;
    if (inj.truncate && text.length > 40) text = text.slice(0, Math.floor(text.length / 3));
    if (inj.extraLatencyMs) await sleep(inj.extraLatencyMs);

    const latencyMs = Date.now() - start;
    return {
      text,
      latencyMs,
      firstTokenMs: firstTokenMs || latencyMs,
      usage,
      logprobs,
    };
  }
}

// Anthropic adapter: no token probabilities -> behavior fingerprint only.
class AnthropicClient implements UnifiedClient {
  private apiKey: string;
  constructor(
    readonly endpoint: EndpointConfig,
    private inject?: InjectConfig,
  ) {
    this.apiKey = resolveApiKey(endpoint.apiKeyEnv);
  }

  async chat(messages: ChatMessage[], opts: Partial<ChatOpts> = {}): Promise<ChatResult> {
    const merged: ChatOpts = {
      model: opts.model ?? this.endpoint.model,
      temperature: opts.temperature ?? 0,
      maxTokens: opts.maxTokens ?? 1024,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT,
    };
    const inj = applyInject(this.endpoint, merged, this.inject);
    const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const rest = messages.filter((m) => m.role !== "system");

    const start = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), merged.timeoutMs);
    try {
      const res = await fetch(`${this.endpoint.baseUrl}/v1/messages`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: inj.model,
          system: sys || undefined,
          messages: rest.map((m) => ({ role: m.role, content: m.content })),
          temperature: merged.temperature,
          max_tokens: merged.maxTokens,
        }),
      });
      const json = (await res.json()) as {
        content?: { text?: string }[];
        usage?: { input_tokens: number; output_tokens: number };
      };
      let text = json.content?.map((c) => c.text ?? "").join("") ?? "";
      if (inj.truncate && text.length > 40) text = text.slice(0, Math.floor(text.length / 3));
      if (inj.extraLatencyMs) await sleep(inj.extraLatencyMs);
      const latencyMs = Date.now() - start;
      return {
        text,
        latencyMs,
        firstTokenMs: latencyMs,
        usage: json.usage
          ? { prompt: json.usage.input_tokens, completion: json.usage.output_tokens }
          : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
