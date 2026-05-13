import { useCallback, useEffect, useMemo, useState } from "react";
import { postAgentStep, postSession, postTask, type ToolCall } from "./api";
import { captureSnapshot, executeToolCall, getActiveTabId } from "./tools";

type LogLine = { t: number; level: "info" | "error"; text: string };

const STORAGE_KEYS = {
  apiBaseUrl: "apiBaseUrl",
  extensionKey: "extensionKey",
  email: "email",
  userId: "userId",
} as const;

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:3000");
  const [extensionKey, setExtensionKey] = useState("");
  const [email, setEmail] = useState("dev@local.test");
  const [userId, setUserId] = useState("");
  const [prompt, setPrompt] = useState("Summarize the visible page in one sentence.");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);

  const log = useCallback((text: string, level: LogLine["level"] = "info") => {
    setLogs((prev) => [...prev, { t: Date.now(), level, text }].slice(-200));
  }, []);

  useEffect(() => {
    void chrome.storage.local.get(Object.values(STORAGE_KEYS)).then((v) => {
      if (typeof v.apiBaseUrl === "string") setApiBaseUrl(v.apiBaseUrl);
      if (typeof v.extensionKey === "string") setExtensionKey(v.extensionKey);
      if (typeof v.email === "string") setEmail(v.email);
      if (typeof v.userId === "string") setUserId(v.userId);
    });
  }, []);

  const saveSettings = useCallback(async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.apiBaseUrl]: apiBaseUrl,
      [STORAGE_KEYS.extensionKey]: extensionKey,
      [STORAGE_KEYS.email]: email,
      [STORAGE_KEYS.userId]: userId,
    });
    log("Saved settings");
  }, [apiBaseUrl, extensionKey, email, userId, log]);

  const bootstrapSession = useCallback(async () => {
    if (!extensionKey) {
      log("Set extension API key first", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await postSession(apiBaseUrl, extensionKey, email);
      setUserId(res.userId);
      await chrome.storage.local.set({ [STORAGE_KEYS.userId]: res.userId, [STORAGE_KEYS.email]: email });
      log(`Session OK — userId ${res.userId}`);
    } catch (e) {
      log(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }, [apiBaseUrl, extensionKey, email, log]);

  const runTask = useCallback(async () => {
    if (!extensionKey || !userId) {
      log("Bootstrap session first", "error");
      return;
    }
    setBusy(true);
    try {
      const { taskId } = await postTask(apiBaseUrl, extensionKey, userId, prompt);
      log(`Task created: ${taskId}`);

      let tabId = await getActiveTabId();
      let snapshot = await captureSnapshot(tabId);
      let toolResults: { tool_call_id: string; content: string }[] | undefined;
      let screenshots: { tool_call_id: string; dataUrl: string }[] | undefined;
      let finished = false;

      for (let round = 0; round < 60; round += 1) {
        const res = await postAgentStep(apiBaseUrl, extensionKey, {
          taskId,
          userId,
          pageSnapshot: snapshot,
          toolResults,
          screenshots,
        });

        toolResults = undefined;
        screenshots = undefined;

        if (res.status === "completed") {
          log(`Done: ${res.summary}`);
          finished = true;
          break;
        }

        const results: { tool_call_id: string; content: string }[] = [];
        const shots: { tool_call_id: string; dataUrl: string }[] = [];
        for (const tc of res.toolCalls) {
          if (tc.type !== "function") continue;
          let content: string;
          let screenshotDataUrl: string | undefined;
          try {
            const out = await executeToolCall(tabId, tc as ToolCall);
            content = out.content;
            screenshotDataUrl = out.screenshotDataUrl;
          } catch (err) {
            content = JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              hint: "The page likely changed; do not assume earlier refs still exist. Use the next snapshot to pick a fresh ref.",
            });
          }
          results.push({ tool_call_id: tc.id, content });
          if (screenshotDataUrl) shots.push({ tool_call_id: tc.id, dataUrl: screenshotDataUrl });
          log(`Tool ${tc.function.name} → ${content.slice(0, 180)}${content.length > 180 ? "…" : ""}`);
        }

        tabId = await getActiveTabId();
        snapshot = await captureSnapshot(tabId);
        toolResults = results;
        screenshots = shots.length ? shots : undefined;
      }

      if (!finished) log("Stopped: max rounds reached", "error");
    } catch (e) {
      log(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }, [apiBaseUrl, extensionKey, userId, prompt, log]);

  const logText = useMemo(() => logs.map((l) => `[${new Date(l.t).toLocaleTimeString()}] ${l.text}`).join("\n"), [logs]);

  return (
    <div className="wrap">
      <header className="header">
        <div>
          <div className="title">Browser agent</div>
          <div className="subtitle">Side panel · Next.js backend · OpenAI tools</div>
        </div>
      </header>

      <section className="card">
        <label className="label">API base URL</label>
        <input className="input" value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} />

        <label className="label">Extension API key</label>
        <input
          className="input"
          type="password"
          value={extensionKey}
          onChange={(e) => setExtensionKey(e.target.value)}
          placeholder="Matches EXTENSION_API_KEY on the server"
        />

        <label className="label">Dev email</label>
        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />

        <div className="row">
          <button className="btn" type="button" disabled={busy} onClick={() => void bootstrapSession()}>
            Bootstrap session
          </button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => void saveSettings()}>
            Save settings
          </button>
        </div>

        <div className="meta">{userId ? `userId: ${userId}` : "No session yet"}</div>
      </section>

      <section className="card">
        <label className="label">Goal</label>
        <textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} />

        <button className="btn primary" type="button" disabled={busy} onClick={() => void runTask()}>
          {busy ? "Running…" : "Run on active tab"}
        </button>
      </section>

      <section className="card">
        <label className="label">Log</label>
        <pre className="log">{logText || "…"}</pre>
      </section>
    </div>
  );
}
