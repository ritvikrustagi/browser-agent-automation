import { jsonResponse, optionsResponse } from "@/lib/cors";

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function GET(request: Request) {
  return jsonResponse({ ok: true, service: "browser-automation-api" }, { request });
}
