import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { GraderType, TestItem } from "@driftsentinel/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
// sandbox/grader_runner.py lives at repo root; from packages/probe/dist -> ../../../sandbox
const RUNNER = resolve(__dirname, "../../../sandbox/grader_runner.py");

export interface GradeResult {
  score: number; // 0..1
  detail?: string;
}

// Runs model code + unit test in the Python sandbox.
export function gradeUnitTest(
  code: string,
  testSpec: string,
  timeoutS = 5,
): Promise<GradeResult> {
  return new Promise((resolvePromise) => {
    const useDocker = process.env.DRIFT_SANDBOX === "docker";
    const cmd = useDocker ? "docker" : "python3";
    const args = useDocker
      ? [
          "run",
          "--rm",
          "-i",
          "--network=none",
          "--read-only",
          "--memory=512m",
          "--cpus=1",
          "--pids-limit=64",
          "driftsentinel-sandbox",
        ]
      : [RUNNER];

    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const killTimer = setTimeout(() => child.kill("SIGKILL"), (timeoutS + 5) * 1000);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(killTimer);
      resolvePromise({ score: 0, detail: `spawn-error: ${e.message}` });
    });
    child.on("close", () => {
      clearTimeout(killTimer);
      try {
        const parsed = JSON.parse(out) as {
          passed: boolean;
          total: number;
          stderr: string;
        };
        resolvePromise({
          score: parsed.passed ? 1 : 0,
          detail: parsed.stderr || undefined,
        });
      } catch {
        resolvePromise({ score: 0, detail: `bad-output: ${err || out}`.slice(0, 300) });
      }
    });

    child.stdin.write(JSON.stringify({ code, test: testSpec, timeout_s: timeoutS }));
    child.stdin.end();
  });
}

// Extract the model's code block from a chat response.
export function extractCode(text: string): string {
  const fenced = text.match(/```(?:python)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function gradeNumeric(text: string, spec: string): GradeResult {
  // spec: "answer=42" or "answer=42|tol=0.1"
  const m = spec.match(/answer=([-\d.]+)(?:\|tol=([\d.]+))?/);
  if (!m) return { score: 0, detail: "bad-spec" };
  const target = parseFloat(m[1]);
  const tol = m[2] ? parseFloat(m[2]) : 0;
  const nums = text.match(/-?\d+(?:\.\d+)?/g);
  if (!nums) return { score: 0, detail: "no-number" };
  const last = parseFloat(nums[nums.length - 1]);
  return { score: Math.abs(last - target) <= tol ? 1 : 0 };
}

function gradeExact(text: string, spec: string): GradeResult {
  // spec: the expected answer (e.g. "C"). Match last standalone token.
  const want = spec.trim().toUpperCase();
  const letters = text.toUpperCase().match(/\b[A-E]\b/g);
  const got = letters ? letters[letters.length - 1] : text.trim().toUpperCase();
  return { score: got === want ? 1 : 0 };
}

function gradeRegex(text: string, spec: string): GradeResult {
  try {
    return { score: new RegExp(spec, "s").test(text) ? 1 : 0 };
  } catch {
    return { score: 0, detail: "bad-regex" };
  }
}

function gradeKeyword(text: string, spec: string): GradeResult {
  const keys = spec.split("|").map((k) => k.trim().toLowerCase());
  const lc = text.toLowerCase();
  const hit = keys.filter((k) => lc.includes(k)).length;
  return { score: keys.length ? hit / keys.length : 0 };
}

function gradeJsonSchema(text: string, spec: string): GradeResult {
  // spec: "fields=3" -> JSON must parse and have exactly N top-level fields
  const m = spec.match(/fields=(\d+)/);
  const block = text.match(/\{[\s\S]*\}/);
  if (!block) return { score: 0, detail: "no-json" };
  try {
    const obj = JSON.parse(block[0]) as Record<string, unknown>;
    if (m) {
      return { score: Object.keys(obj).length === parseInt(m[1], 10) ? 1 : 0 };
    }
    return { score: 1 };
  } catch {
    return { score: 0, detail: "invalid-json" };
  }
}

export async function grade(item: TestItem, responseText: string): Promise<GradeResult> {
  const t: GraderType = item.grader.type;
  switch (t) {
    case "unit_test":
      return gradeUnitTest(
        extractCode(responseText),
        item.grader.spec,
        item.grader.timeoutS ?? 5,
      );
    case "numeric_tolerance":
      return gradeNumeric(responseText, item.grader.spec);
    case "exact":
      return gradeExact(responseText, item.grader.spec);
    case "regex":
      return gradeRegex(responseText, item.grader.spec);
    case "keyword_hit":
      return gradeKeyword(responseText, item.grader.spec);
    case "json_schema":
      return gradeJsonSchema(responseText, item.grader.spec);
    default:
      return { score: 0, detail: `unknown-grader: ${t as string}` };
  }
}
