import type { PageSnapshot } from "../types";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  extensionKey: string,
  init: RequestInit,
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Extension-Key": extensionKey,
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? text ?? res.statusText;
    throw new Error(message);
  }

  return data as T;
}

export async function postSession(baseUrl: string, extensionKey: string, email: string) {
  return apiRequest<{ userId: string; email: string }>(baseUrl, "/api/session", extensionKey, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function postTask(baseUrl: string, extensionKey: string, userId: string, prompt: string) {
  return apiRequest<{ taskId: string }>(baseUrl, "/api/tasks", extensionKey, {
    method: "POST",
    body: JSON.stringify({ userId, prompt }),
  });
}

export type AgentStepResponse =
  | {
      status: "tool_calls";
      stepNumber: number;
      toolCalls: ToolCall[];
    }
  | { status: "completed"; summary: string; success: boolean };

export async function postAgentStep(
  baseUrl: string,
  extensionKey: string,
  body: {
    taskId: string;
    userId: string;
    pageSnapshot: PageSnapshot;
    toolResults?: { tool_call_id: string; content: string }[];
  },
) {
  return apiRequest<AgentStepResponse>(baseUrl, "/api/agent/step", extensionKey, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
