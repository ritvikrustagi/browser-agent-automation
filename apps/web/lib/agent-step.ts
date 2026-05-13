import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import OpenAI from "openai";
import { prisma } from "./prisma";
import { AGENT_TOOLS, SYSTEM_PROMPT } from "./agent-tools";
import { formatSnapshotForModel, type PageSnapshot } from "./snapshot";
import type { Prisma } from "@prisma/client";

type ToolResult = { tool_call_id: string; content: string };

export type AgentStepResult =
  | {
      status: "tool_calls";
      toolCalls: NonNullable<OpenAI.Chat.ChatCompletionMessage["tool_calls"]>;
      stepNumber: number;
    }
  | { status: "completed"; summary: string; success: boolean }
  | { status: "error"; message: string };

function asMessages(json: Prisma.JsonValue | null | undefined): ChatCompletionMessageParam[] {
  if (!json || !Array.isArray(json)) return [];
  return json as unknown as ChatCompletionMessageParam[];
}

function findDoneResolution(
  assistant: ChatCompletionMessageParam,
  toolResults: ToolResult[],
): { summary: string; success: boolean } | null {
  if (assistant.role !== "assistant" || !("tool_calls" in assistant) || !assistant.tool_calls?.length) return null;

  for (const tc of assistant.tool_calls) {
    if (tc.type !== "function" || tc.function.name !== "done") continue;
    const tr = toolResults.find((r) => r.tool_call_id === tc.id);
    let modelArgs: { summary?: string; success?: boolean } = {};
    try {
      modelArgs = JSON.parse(tc.function.arguments || "{}") as { summary?: string; success?: boolean };
    } catch {
      modelArgs = {};
    }
    if (!tr) {
      return { summary: modelArgs.summary ?? "Done", success: modelArgs.success ?? true };
    }
    try {
      const parsed = JSON.parse(tr.content) as { summary?: string; success?: boolean };
      return {
        summary: parsed.summary ?? modelArgs.summary ?? "Done",
        success: parsed.success ?? modelArgs.success ?? true,
      };
    } catch {
      return { summary: modelArgs.summary ?? "Done", success: modelArgs.success ?? true };
    }
  }
  return null;
}

export async function runAgentStep(input: {
  taskId: string;
  userId: string;
  pageSnapshot: PageSnapshot;
  toolResults?: ToolResult[];
}): Promise<AgentStepResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { status: "error", message: "OPENAI_API_KEY is not configured" };
  }

  const task = await prisma.task.findFirst({
    where: { id: input.taskId, userId: input.userId },
  });
  if (!task) return { status: "error", message: "Task not found" };

  if (task.status === "completed" || task.status === "cancelled") {
    return { status: "error", message: "Task is not active" };
  }

  let messages = asMessages(task.agentMessages);

  if (messages.length === 0) {
    messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `User goal:\n${task.prompt}\n\nCurrent page:\n${formatSnapshotForModel(input.pageSnapshot)}`,
      },
    ];
  } else if (input.toolResults?.length) {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || !("tool_calls" in last) || !last.tool_calls?.length) {
      return { status: "error", message: "Invalid conversation state: tool results without assistant tool_calls" };
    }

    for (const tr of input.toolResults) {
      messages.push({ role: "tool", tool_call_id: tr.tool_call_id, content: tr.content });
    }

    await resolveApprovalsFromToolResults({
      taskId: task.id,
      toolResults: input.toolResults,
      previousAssistant: last,
    });

    const done = findDoneResolution(last, input.toolResults);
    if (done) {
      const stepNumber =
        (await prisma.agentStep.aggregate({ where: { taskId: task.id }, _max: { stepNumber: true } }))._max
          .stepNumber ?? 0;
      const nextStep = stepNumber + 1;

      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          agentMessages: messages as unknown as Prisma.InputJsonValue,
        },
      });

      await prisma.agentStep.create({
        data: {
          taskId: task.id,
          stepNumber: nextStep,
          observation: formatSnapshotForModel(input.pageSnapshot),
          actionType: "done",
          actionPayload: done as unknown as Prisma.InputJsonValue,
          result: done as unknown as Prisma.InputJsonValue,
        },
      });

      await prisma.actionLog.create({
        data: {
          taskId: task.id,
          userId: input.userId,
          eventType: "agent_done",
          payload: done as unknown as Prisma.InputJsonValue,
        },
      });

      return { status: "completed", summary: done.summary, success: done.success };
    }

    messages.push({
      role: "user",
      content: `Updated page after tool execution:\n${formatSnapshotForModel(input.pageSnapshot)}`,
    });
  } else {
    messages.push({
      role: "user",
      content: `Updated page:\n${formatSnapshotForModel(input.pageSnapshot)}`,
    });
  }

  const stepNumber =
    (await prisma.agentStep.aggregate({ where: { taskId: task.id }, _max: { stepNumber: true } }))._max.stepNumber ??
    0;

  const nextStep = stepNumber + 1;

  await prisma.task.update({
    where: { id: task.id },
    data: { status: "running", agentMessages: messages as unknown as Prisma.InputJsonValue },
  });

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model,
    messages,
    tools: AGENT_TOOLS,
    tool_choice: "auto",
    temperature: 0.2,
  });

  const choice = completion.choices[0]?.message;
  if (!choice) return { status: "error", message: "Empty model response" };

  if (choice.tool_calls?.length) {
    messages.push({
      role: "assistant",
      content: choice.content ?? null,
      tool_calls: choice.tool_calls,
    });

    await prisma.task.update({
      where: { id: task.id },
      data: { agentMessages: messages as unknown as Prisma.InputJsonValue },
    });

    const step = await prisma.agentStep.create({
      data: {
        taskId: task.id,
        stepNumber: nextStep,
        observation: formatSnapshotForModel(input.pageSnapshot),
        reasoningSummary: choice.content ?? undefined,
        actionType: "tool_calls",
        actionPayload: choice.tool_calls as unknown as Prisma.InputJsonValue,
      },
    });

    for (const tc of choice.tool_calls) {
      if (tc.type !== "function") continue;
      await prisma.toolCall.create({
        data: {
          taskId: task.id,
          agentStepId: step.id,
          toolName: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || "{}") as unknown as Prisma.InputJsonValue,
        },
      });

      if (tc.function.name === "request_human_approval") {
        const args = JSON.parse(tc.function.arguments || "{}") as { message?: string; proposed_action?: string };
        await prisma.approval.create({
          data: {
            taskId: task.id,
            toolCallId: tc.id,
            actionType: "request_human_approval",
            actionPayload: {
              message: args.message ?? "",
              proposed_action: args.proposed_action ?? "",
            } as unknown as Prisma.InputJsonValue,
            status: "pending",
          },
        });
      }
    }

    await prisma.actionLog.create({
      data: {
        taskId: task.id,
        userId: input.userId,
        eventType: "agent_tool_calls",
        payload: { step: nextStep, tool_calls: choice.tool_calls } as unknown as Prisma.InputJsonValue,
      },
    });

    return { status: "tool_calls", toolCalls: choice.tool_calls, stepNumber: nextStep };
  }

  const text = choice.content?.trim() || "";
  messages.push({ role: "assistant", content: choice.content ?? "" });

  await prisma.task.update({
    where: { id: task.id },
    data: {
      agentMessages: messages as unknown as Prisma.InputJsonValue,
      status: "completed",
      completedAt: new Date(),
    },
  });

  await prisma.agentStep.create({
    data: {
      taskId: task.id,
      stepNumber: nextStep,
      observation: formatSnapshotForModel(input.pageSnapshot),
      reasoningSummary: text,
      actionType: "assistant_text",
      result: { content: choice.content } as unknown as Prisma.InputJsonValue,
    },
  });

  return { status: "completed", summary: text || "Finished", success: true };
}

async function resolveApprovalsFromToolResults(input: {
  taskId: string;
  toolResults: ToolResult[];
  previousAssistant: ChatCompletionMessageParam;
}) {
  const assistant = input.previousAssistant;
  if (assistant.role !== "assistant" || !assistant.tool_calls) return;

  for (const tc of assistant.tool_calls) {
    if (tc.type !== "function" || tc.function.name !== "request_human_approval") continue;
    const result = input.toolResults.find((r) => r.tool_call_id === tc.id);
    if (!result) continue;

    let approved = false;
    try {
      const parsed = JSON.parse(result.content) as { approved?: boolean };
      approved = Boolean(parsed.approved);
    } catch {
      approved = false;
    }

    await prisma.approval.updateMany({
      where: { taskId: input.taskId, toolCallId: tc.id },
      data: { status: approved ? "approved" : "rejected", resolvedAt: new Date() },
    });
  }
}
