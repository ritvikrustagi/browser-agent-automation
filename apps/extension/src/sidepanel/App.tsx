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

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

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

  const logNodes = useMemo(
    () =>
      logs.map((l, i) => (
        <div key={`${l.t}-${i}`} className={`log-line ${l.level === "error" ? "log-line--error" : ""}`}>
          <span className="log-time">{formatTime(l.t)}</span>
          <span className="log-text">{l.text}</span>
        </div>
      )),
    [logs],
  );

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <div className="title">Browser agent</div>
            <div className="subtitle">Runs on the active tab · Next.js API · OpenAI tools</div>
          </div>
        </div>
      </header>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Connection</h2>
          <span className={`badge ${userId ? "badge-on" : "badge-off"}`}>{userId ? "Session" : "No session"}</span>
        </div>

        <div className="field">
          <label className="label" htmlFor="api-url">
            API base URL
          </label>
          <input id="api-url" className="input" value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} autoComplete="off" />
        </div>

        <div className="field">
          <label className="label" htmlFor="ext-key">
            Extension API key
          </label>
          <input
            id="ext-key"
            className="input"
            type="password"
            value={extensionKey}
            onChange={(e) => setExtensionKey(e.target.value)}
            placeholder="Same value as EXTENSION_API_KEY in apps/web/.env"
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="email">
            Dev email
          </label>
          <input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>

        <div className="row">
          <button className="btn secondary" type="button" disabled={busy} onClick={() => void bootstrapSession()}>
            Bootstrap session
          </button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => void saveSettings()}>
            Save settings
          </button>
        </div>

        <div className="meta">
          <strong>User id</strong>
          {userId || "Bootstrap to create a user for this browser."}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Task</h2>
        </div>

        <div className="field">
          <label className="label" htmlFor="goal">
            Goal
          </label>
          <textarea id="goal" className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} />
        </div>

        <button className="btn primary" type="button" disabled={busy} onClick={() => void runTask()}>
          {busy ? "Running…" : "Run on active tab"}
        </button>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Activity</h2>
        </div>
        <div className="log-scroll">{logs.length ? logNodes : <div className="log-empty">Logs appear here when you run a task.</div>}</div>
      </section>
    </div>
  );
}
