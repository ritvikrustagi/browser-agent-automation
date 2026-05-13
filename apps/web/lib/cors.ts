const ALLOWED_ORIGIN_PREFIXES = ["chrome-extension://", "http://localhost", "http://127.0.0.1"];

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  const allow =
    ALLOWED_ORIGIN_PREFIXES.some((p) => origin.startsWith(p)) || process.env.NODE_ENV === "development";

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Extension-Key",
    "Access-Control-Max-Age": "86400",
  };

  if (allow && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  } else if (process.env.NODE_ENV === "development") {
    headers["Access-Control-Allow-Origin"] = "*";
  }

  return headers;
}

export function jsonResponse(data: unknown, init: ResponseInit & { request: Request }) {
  const { request, ...rest } = init;
  return Response.json(data, {
    ...rest,
    headers: { ...corsHeaders(request), ...(rest.headers as Record<string, string> | undefined) },
  });
}

export function optionsResponse(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
