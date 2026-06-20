import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig, ChatMessage, DB, EndpointConfig } from "@driftsentinel/core";
import { bus } from "@driftsentinel/core";
import { makeClient } from "@driftsentinel/probe";

interface ChatCompletionRequest {
  model?: string;
  messages?: Array<{
    role?: string;
    content?: unknown;
  }>;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  metadata?: { task?: string };
}

interface RouteRow {
  task: string;
  best_endpoint: string | null;
  weights: string;
}

export function registerOpenAIProxy(app: FastifyInstance, cfg: AppConfig, db: DB): void {
  app.get("/v1/models", async () => ({
    object: "list",
    data: cfg.endpoints.map((ep) => ({
      id: ep.model,
      object: "model",
      owned_by: ep.id,
    })),
  }));

  app.post("/v1/chat/completions", async (req, reply) => {
    const body = (req.body ?? {}) as ChatCompletionRequest;
    const task = inferTask(req, body);
    const endpoint = chooseEndpoint(cfg, db, task);
    if (!endpoint) {
      return reply.code(503).send({
        error: {
          message: "No DriftSentinel endpoint is configured.",
          type: "service_unavailable",
        },
      });
    }

    const messages = normalizeMessages(body.messages);
    if (!messages.length) {
      return reply.code(400).send({
        error: {
          message: "OpenAI-compatible request must include at least one message.",
          type: "invalid_request_error",
        },
      });
    }

    try {
      const client = makeClient(endpoint, cfg.demo.inject);
      const out = await client.chat(messages, {
        model: endpoint.model,
        temperature: body.temperature,
        maxTokens: body.max_tokens ?? body.max_completion_tokens ?? 1024,
        timeoutMs: 60_000,
      });

      bus.emit("route.changed", { task, best: endpoint.id });
      reply.header("x-driftsentinel-endpoint", endpoint.id);
      reply.header("x-driftsentinel-task", task);

      if (body.stream) {
        return sendStream(reply, body.model ?? endpoint.model, endpoint.id, out.text);
      }

      return {
        id: `chatcmpl_ds_${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? endpoint.model,
        driftsentinel: {
          endpoint_id: endpoint.id,
          routed_task: task,
          latency_ms: out.latencyMs,
        },
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: out.text,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: out.usage?.prompt ?? estimateTokens(messages.map((m) => m.content).join("\n")),
          completion_tokens: out.usage?.completion ?? estimateTokens(out.text),
          total_tokens:
            (out.usage?.prompt ?? estimateTokens(messages.map((m) => m.content).join("\n"))) +
            (out.usage?.completion ?? estimateTokens(out.text)),
        },
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.code(502).send({
        error: {
          message: `DriftSentinel proxy upstream failed for ${endpoint.id}: ${message}`,
          type: "upstream_error",
        },
      });
    }
  });
}

function inferTask(req: FastifyRequest, body: ChatCompletionRequest): string {
  const query = req.query as { task?: string };
  const header = req.headers["x-driftsentinel-task"];
  if (typeof query.task === "string" && query.task) return query.task;
  if (typeof header === "string" && header) return header;
  if (body.metadata?.task) return body.metadata.task;
  return "code";
}

function chooseEndpoint(cfg: AppConfig, db: DB, task: string): EndpointConfig | undefined {
  const row = db
    .prepare(`SELECT * FROM routes WHERE task=?`)
    .get(task) as RouteRow | undefined;
  const routed = row?.best_endpoint
    ? cfg.endpoints.find((ep) => ep.id === row.best_endpoint)
    : undefined;
  if (routed) return routed;

  const fallback = bestHealthyEndpoint(cfg, db);
  return fallback ?? cfg.endpoints[0];
}

function bestHealthyEndpoint(cfg: AppConfig, db: DB): EndpointConfig | undefined {
  const rows = db
    .prepare(
      `SELECT p.endpoint_id, p.score
       FROM probe_results p
       JOIN (SELECT endpoint_id, MAX(ts) mt FROM probe_results GROUP BY endpoint_id) m
         ON p.endpoint_id = m.endpoint_id AND p.ts = m.mt
       ORDER BY p.score DESC`,
    )
    .all() as { endpoint_id: string; score: number }[];
  for (const row of rows) {
    const ep = cfg.endpoints.find((e) => e.id === row.endpoint_id);
    if (ep) return ep;
  }
  return undefined;
}

function normalizeMessages(input: ChatCompletionRequest["messages"]): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const out: ChatMessage[] = [];
  for (const m of input) {
    if (m.role !== "system" && m.role !== "user" && m.role !== "assistant") continue;
    out.push({ role: m.role, content: normalizeContent(m.content) });
  }
  return out;
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function sendStream(reply: FastifyReply, model: string, endpointId: string, text: string): void {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-driftsentinel-endpoint": endpointId,
  });
  const id = `chatcmpl_ds_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  reply.raw.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    })}\n\n`,
  );
  reply.raw.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    })}\n\n`,
  );
  reply.raw.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`,
  );
  reply.raw.write("data: [DONE]\n\n");
  reply.raw.end();
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
