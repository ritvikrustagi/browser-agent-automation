import { requireExtensionKey } from "@/lib/auth";
import { jsonResponse, optionsResponse } from "@/lib/cors";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

const patchSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["approved", "rejected"]),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const unauthorized = requireExtensionKey(request);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonResponse({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400, request });
  }

  const approval = await prisma.approval.findFirst({
    where: { id, task: { userId: parsed.data.userId } },
  });

  if (!approval) return jsonResponse({ error: "Not found" }, { status: 404, request });

  const updated = await prisma.approval.update({
    where: { id },
    data: {
      status: parsed.data.status,
      resolvedAt: new Date(),
    },
  });

  return jsonResponse({ approval: updated }, { request });
}
