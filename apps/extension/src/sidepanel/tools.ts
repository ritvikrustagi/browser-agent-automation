import type { ToolCall } from "./api";
import type { PageSnapshot } from "../types";

export async function getActiveTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const id = tabs[0]?.id;
  if (id == null) throw new Error("No active tab");
  return id;
}

export async function captureSnapshot(tabId: number): Promise<PageSnapshot> {
  const res = (await chrome.tabs.sendMessage(tabId, { type: "AGENT_CAPTURE_SNAPSHOT" })) as
    | { ok: true; snapshot: PageSnapshot }
    | { ok?: false; error?: string };

  if (!res || !("ok" in res) || !res.ok) {
    throw new Error("error" in res && res.error ? res.error : "Could not capture page (restricted page?)");
  }

  return res.snapshot;
}

async function sendExecute(tabId: number, name: string, args: Record<string, unknown>) {
  const res = (await chrome.tabs.sendMessage(tabId, { type: "AGENT_EXECUTE", name, args })) as
    | { ok: true; result: unknown }
    | { ok?: false; error?: string };

  if (!res || !("ok" in res) || !res.ok) {
    throw new Error("error" in res && res.error ? res.error : "Execute failed");
  }

  return res.result;
}

export function waitMs(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function waitTabComplete(tabId: number, timeoutMs = 45000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Navigation timeout"));
    }, timeoutMs);

    const listener: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (id, info) => {
      if (id === tabId && info.status === "complete") {
        window.clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

export async function executeToolCall(tabId: number, tool: ToolCall): Promise<string> {
  const name = tool.function.name;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tool.function.arguments || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }

  switch (name) {
    case "navigate": {
      const url = String(args.url ?? "");
      await chrome.tabs.update(tabId, { url });
      await waitTabComplete(tabId);
      await waitMs(400);
      return JSON.stringify({ ok: true, url });
    }
    case "wait_ms": {
      const ms = Math.min(30000, Math.max(0, Number(args.ms ?? 0)));
      await waitMs(ms);
      return JSON.stringify({ ok: true, waited: ms });
    }
    case "click_element":
    case "type_text":
    case "scroll_page":
      await sendExecute(tabId, name, args);
      return JSON.stringify({ ok: true });
    case "request_human_approval": {
      const message = String(args.message ?? "Approve this step?");
      const approved = window.confirm(`Agent approval:\n\n${message}`);
      return JSON.stringify({ approved });
    }
    case "done":
      return JSON.stringify({
        summary: String(args.summary ?? ""),
        success: Boolean(args.success),
      });
    default:
      return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
  }
}
