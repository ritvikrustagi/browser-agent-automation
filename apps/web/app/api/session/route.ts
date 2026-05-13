import { requireExtensionKey } from "@/lib/auth";
import { jsonResponse, optionsResponse } from "@/lib/cors";
import { prisma } from "@/lib/prisma";
import { sessionBodySchema } from "@/lib/schemas";

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function POST(request: Request) {
  const unauthorized = requireExtensionKey(request);
  if (unauthorized) return unauthorized;

  const body = sessionBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return jsonResponse({ error: "Invalid body", details: body.error.flatten() }, { status: 400, request });
  }

  const user = await prisma.user.upsert({
    where: { email: body.data.email },
    create: { email: body.data.email },
    update: {},
  });

  return jsonResponse({ userId: user.id, email: user.email }, { request });
}
