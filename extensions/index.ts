import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// thresholds + colors
const THRESHOLDS = { slow: 0, medium: 15, fast: 30, blazing: 50 };
const COLORS = {
  slow: "#f87171", // slow 0-15
  medium: "#fbbf24", // medium 15-30
  fast: "#34d399", // fast 30-50
  blazing: "#38bdf8", // blazing 50+
};

const STATUS_KEY = "tps";
const WINDOW_MS = 1000;
const MIN_SPAN_MS = 100;
const UPDATE_INTERVAL_MS = 100;
const GENERATION_TOOLS = new Set(["edit", "write"]);
const TOKEN_REGEX = /\w+|[^\s\w]/g;

function truecolor(text: string, hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

function getColor(tps: number): string {
  if (tps >= THRESHOLDS.blazing) return COLORS.blazing;
  if (tps >= THRESHOLDS.fast) return COLORS.fast;
  if (tps >= THRESHOLDS.medium) return COLORS.medium;
  return COLORS.slow;
}

// sliding window
interface Stamp {
  time: number;
  tokens: number;
}

export default async (pi: ExtensionAPI) => {
  let events: Stamp[] = [];
  let startIndex = 0;
  let isStreaming = false;
  let startTime = 0;
  let tokenCount = 0;
  let pausedTotal = 0;
  let pauseStart = 0;
  let isPaused = false;
  let lastRender = 0;
  let ttftStart = 0;
  let ttftEnd = 0;

  function start() {
    if (isStreaming) return;
    isStreaming = true;
    events = [];
    startIndex = 0;
    startTime = Date.now();
    tokenCount = 0;
    pausedTotal = 0;
    isPaused = false;
    // TTFT: user msg -> first token, once
    if (ttftEnd === 0) {
      if (ttftStart === 0) ttftStart = Date.now();
      ttftEnd = Date.now();
    }
  }

  // estimate tokens by word boundaries
  function estimateTokens(text: string): number {
    if (!text) return 0;
    const m = text.match(TOKEN_REGEX);
    return m ? m.length : 0;
  }

  function record(text: string) {
    const n = estimateTokens(text);
    if (n <= 0) return;
    tokenCount += n;
    events.push({ time: Date.now(), tokens: n });
  }

  // pause timer during non-write tools
  function pause() {
    if (!isStreaming || isPaused) return;
    isPaused = true;
    pauseStart = Date.now();
  }

  function resume() {
    if (!isPaused) return;
    isPaused = false;
    pausedTotal += Date.now() - pauseStart;
  }

  function calcTps(now: number): number {
    const windowStart = now - WINDOW_MS;
    while (startIndex < events.length && events[startIndex].time < windowStart) {
      startIndex++;
    }
    if (startIndex >= events.length) return 0;

    let n = 0;
    for (let i = startIndex; i < events.length; i++) n += events[i].tokens;
    if (n === 0) return 0;

    // include stall gap on same-ms flush
    let spanStart = events[startIndex].time;
    if (
      events[startIndex].time === events[events.length - 1].time &&
      startIndex > 0
    ) {
      spanStart = events[startIndex - 1].time;
    }
    const span = Math.max(now - spanStart, MIN_SPAN_MS);
    return (1000 * n) / span;
  }

  // throttle status updates
  function renderThrottled(ctx: ExtensionContext, tps: number) {
    const now = Date.now();
    if (now - lastRender < UPDATE_INTERVAL_MS) return;
    lastRender = now;
    render(ctx, tps);
  }

  function ttftSuffix(ctx: ExtensionContext): string {
    const ms = ttftEnd - ttftStart;
    if (!(ms > 0)) return "";
    const text = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
    return ctx.ui.theme.fg("dim", ` · TTFT ${text}`);
  }

  function render(ctx: ExtensionContext, tps: number) {
    const prefix = ctx.ui.theme.fg("dim", "TPS:");
    ctx.ui.setStatus(
      STATUS_KEY,
      `${prefix} ${truecolor(tps.toFixed(1), getColor(tps))}${ttftSuffix(ctx)}`,
    );
  }

  pi.on("session_start", async (_, ctx: ExtensionContext) => {
    ttftStart = 0;
    ttftEnd = 0;
    ctx.ui.setStatus(STATUS_KEY, `${ctx.ui.theme.fg("dim", "TPS:")} --`);
  });

  pi.on("session_shutdown", () => {
    isStreaming = false;
  });

  pi.on("message_start", (event: any) => {
    if (event.message?.role === "user") {
      ttftStart = Date.now();
      ttftEnd = 0;
    }
  });

  pi.on("message_update", (event: any, ctx: ExtensionContext) => {
    const e = event?.assistantMessageEvent;
    if (!e) return;

    if (
      e.type === "text_start" ||
      e.type === "thinking_start" ||
      e.type === "toolcall_start"
    ) {
      start();
      return;
    }

    if (e.type === "text_delta" || e.type === "thinking_delta") {
      if (!isStreaming) start();
      resume();
      record(e.delta ?? "");
      renderThrottled(ctx, calcTps(Date.now()));
    }

    // count edit/write output; pause for other tools
    if (e.type === "toolcall_delta") {
      const tc = e.partial?.content?.[e.contentIndex ?? 0];
      if (tc?.type === "toolCall" && GENERATION_TOOLS.has(tc.name ?? "")) {
        if (!isStreaming) start();
        resume();
        record(e.delta ?? "");
        renderThrottled(ctx, calcTps(Date.now()));
      }
    }

    if (e.type === "toolcall_end") {
      const tc = e.partial?.content?.[e.contentIndex ?? 0];
      if (tc?.type === "toolCall" && !GENERATION_TOOLS.has(tc.name ?? "")) {
        pause();
      }
    }
  });

  pi.on("agent_end", (event: AgentEndEvent, ctx: ExtensionContext) => {
    isStreaming = false;
    const elapsed = (Date.now() - startTime - pausedTotal) / 1000;
    // prefer provider-reported total
    const outputTokens = event.messages.reduce((acc, curr: any) => {
      if (curr.role === "assistant") return acc + (curr.usage?.output ?? 0);
      if (curr.role === "toolResult") return acc + (curr.usage?.output ?? 0);
      return acc;
    }, 0);
    const total = outputTokens > 0 ? outputTokens : tokenCount;
    const avg = elapsed > 0 ? total / elapsed : 0;
    if (total > 0) render(ctx, avg);
  });
};
