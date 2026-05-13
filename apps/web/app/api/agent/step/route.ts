import { runAgentStep } from "@/lib/agent-step";
import { requireExtensionKey } from "@/lib/auth";
import { jsonResponse, optionsResponse } from "@/lib/cors";
import { agentStepBodySchema } from "@/lib/schemas";

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function POST(request: Request) {
  const unauthorized = requireExtensionKey(request);
  if (unauthorized) return unauthorized;

  const parsed = agentStepBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonResponse({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400, request });
  }

  try {
    const result = await runAgentStep(parsed.data);

    if (result.status === "error") {
      return jsonResponse({ error: result.message }, { status: 400, request });
    }

    if (result.status === "completed") {
      return jsonResponse(
        { status: "completed", summary: result.summary, success: result.success },
        { request },
      );
    }

    return jsonResponse(
      {
        status: "tool_calls",
        stepNumber: result.stepNumber,
        toolCalls: result.toolCalls.map((tc) =>
          tc.type === "function"
            ? {
                id: tc.id,
                type: tc.type,
                function: { name: tc.function.name, arguments: tc.function.arguments },
              }
            : { id: tc.id, type: tc.type },
        ),
      },
      { request },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent step failed";
    return jsonResponse({ error: message }, { status: 500, request });
  }
}
