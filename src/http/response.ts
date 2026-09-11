interface ApiBody<T> {
  code: 0 | 1;
  msg: string;
  data: T;
  errors?: string[];
}

export function successResponse<T>(
  msg: string,
  data: T,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return jsonResponse({ code: 1, msg, data }, status, headers);
}

export function errorResponse<T = null>(
  msg: string,
  status: number,
  options: { data?: T; errors?: string[]; headers?: HeadersInit } = {},
): Response {
  return jsonResponse(
    {
      code: 0,
      msg,
      data: options.data === undefined ? null : options.data,
      ...(options.errors === undefined ? {} : { errors: options.errors }),
    },
    status,
    options.headers,
  );
}

export function methodNotAllowed(allowedMethod: string): Response {
  return errorResponse("请求方法不支持", 405, {
    headers: { Allow: allowedMethod, "Cache-Control": "no-store" },
  });
}

function jsonResponse<T>(
  body: ApiBody<T>,
  status: number,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}
