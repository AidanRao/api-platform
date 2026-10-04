/** Expected HTTP failures shared by platform infrastructure and business modules. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 502 | 503,
    readonly data: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
