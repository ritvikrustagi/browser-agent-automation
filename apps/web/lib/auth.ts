import { jsonResponse } from "./cors";

export function requireExtensionKey(request: Request): Response | null {
  const key = process.env.EXTENSION_API_KEY;
  if (!key) {
    return jsonResponse({ error: "EXTENSION_API_KEY is not configured" }, { status: 500, request });
  }

  const header = request.headers.get("x-extension-key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (header !== key) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401, request });
  }

  return null;
}
