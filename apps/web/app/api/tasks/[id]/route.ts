import { requireExtensionKey } from "@/lib/auth";
import { jsonResponse, optionsResponse } from "@/lib/cors";
import { prisma } from "@/lib/prisma";

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const unauthorized = requireExtensionKey(request);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return jsonResponse({ error: "userId query parameter is required" }, { status: 400, request });
  }

  const task = await prisma.task.findFirst({
    where: { id, userId },
    include: {
      agentSteps: { orderBy: { stepNumber: "asc" }, take: 200 },
      approvals: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });

  if (!task) return jsonResponse({ error: "Not found" }, { status: 404, request });

  return jsonResponse({ task }, { request });
}
