import { requireExtensionKey } from "@/lib/auth";
import { jsonResponse, optionsResponse } from "@/lib/cors";
import { prisma } from "@/lib/prisma";
import { taskCreateSchema } from "@/lib/schemas";
import type { Prisma } from "@prisma/client";

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function GET(request: Request) {
  const unauthorized = requireExtensionKey(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return jsonResponse({ error: "userId query parameter is required" }, { status: 400, request });
  }

  const tasks = await prisma.task.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      prompt: true,
      status: true,
      createdAt: true,
      completedAt: true,
    },
  });

  return jsonResponse({ tasks }, { request });
}

export async function POST(request: Request) {
  const unauthorized = requireExtensionKey(request);
  if (unauthorized) return unauthorized;

  const parsed = taskCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonResponse({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400, request });
  }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) {
    return jsonResponse({ error: "User not found" }, { status: 404, request });
  }

  const task = await prisma.task.create({
    data: {
      userId: parsed.data.userId,
      prompt: parsed.data.prompt,
      status: "pending",
    },
  });

  await prisma.actionLog.create({
    data: {
      taskId: task.id,
      userId: parsed.data.userId,
      eventType: "task_created",
      payload: { prompt: parsed.data.prompt } as unknown as Prisma.InputJsonValue,
    },
  });

  return jsonResponse(
    { taskId: task.id, status: task.status, createdAt: task.createdAt },
    { status: 201, request },
  );
}
