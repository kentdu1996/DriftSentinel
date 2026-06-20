import type {
  ChatMessage,
  ChatOpts,
  ChatResult,
  EndpointConfig,
  InjectConfig,
} from "@driftsentinel/core";
import type { UnifiedClient } from "./client.js";

// Simulated endpoint for offline dev/demo/CI (no API key, no credits).
// A "strong" model solves the seed code tasks correctly and writes rich,
// varied canary answers. A "degraded" model (via inject) produces wrong/
// truncated code and collapsed, repetitive output — exactly the signal the
// drift engine should catch.

const SOLUTIONS: Record<string, string> = {
  add: "def add(a, b):\n    return a + b",
  is_even: "def is_even(n):\n    return n % 2 == 0",
  fib: "def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a",
  reverse_words: "def reverse_words(s):\n    return ' '.join(s.split()[::-1])",
  is_balanced:
    "def is_balanced(s):\n    pairs = {')': '(', ']': '[', '}': '{'}\n    st = []\n    for c in s:\n        if c in '([{':\n            st.append(c)\n        elif c in pairs:\n            if not st or st.pop() != pairs[c]:\n                return False\n    return not st",
};

const DEGRADED_SOLUTIONS: Record<string, string> = {
  // subtly or overtly wrong, like a quantized/small model would produce
  add: "def add(a, b):\n    return a + b",
  is_even: "def is_even(n):\n    return n % 2 == 1",
  fib: "def fib(n):\n    return n",
  reverse_words: "def reverse_words(s):\n    return s[::-1]",
  is_balanced: "def is_balanced(s):\n    return s.count('(') == s.count(')')",
};

const CANARY_RICH = [
  "A hash map is a data structure that stores key-value pairs using a hash function to compute an index into an array of buckets. Think of it like a coat-check counter: you hand over your coat (value) and receive a numbered ticket (key) that lets you retrieve it instantly later.",
  "A hash map maps keys to values by hashing each key to a bucket index, giving average O(1) lookups. It's like a library card catalog: the call number (hash) sends you straight to the right shelf instead of scanning every book.",
  "A hash map is an associative array that uses a hash function to place entries into buckets for fast retrieval. Imagine a parking garage where your license plate determines your assigned spot, so staff can find your car without searching every floor.",
];

const CANARY_COLLAPSED = [
  "A hash map stores data. It is fast.",
  "A hash map stores data. It is fast.",
  "A hash map is a map. It stores things quickly.",
];

function detectFn(prompt: string): string | undefined {
  for (const name of Object.keys(SOLUTIONS)) {
    if (prompt.includes(`\`${name}(`) || prompt.includes(`${name}(`)) return name;
  }
  return undefined;
}

function pick<T>(arr: T[], temp: number): T {
  // low temp -> first (deterministic); high temp -> random
  if (temp < 0.3) return arr[0];
  return arr[Math.floor(Math.random() * arr.length)];
}

export class MockClient implements UnifiedClient {
  private degraded: boolean;
  constructor(
    readonly endpoint: EndpointConfig,
    inject?: InjectConfig,
  ) {
    this.degraded = !!inject?.enabled && inject.target === endpoint.id;
  }

  async chat(messages: ChatMessage[], opts: Partial<ChatOpts> = {}): Promise<ChatResult> {
    const temp = opts.temperature ?? 0;
    const userMsg = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const fn = detectFn(userMsg);

    let text: string;
    if (fn) {
      const sol = this.degraded ? DEGRADED_SOLUTIONS[fn] : SOLUTIONS[fn];
      text = "```python\n" + sol + "\n```";
    } else {
      // canary / general prompt
      text = this.degraded ? pick(CANARY_COLLAPSED, temp) : pick(CANARY_RICH, temp);
    }

    // Simulate latency: degraded endpoint is slower & more variable.
    const base = this.degraded ? 1400 : 600;
    const jitter = this.degraded ? 900 : 250;
    const latencyMs = Math.round(base + Math.random() * jitter);
    await sleep(Math.min(latencyMs, 60));

    return {
      text,
      latencyMs,
      firstTokenMs: Math.round(latencyMs * 0.4),
      usage: { prompt: userMsg.length, completion: text.length },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
