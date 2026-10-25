import type { z } from "zod";
import type { Context } from "hono";
import { ApiError } from "./errors";

export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("；"), 400);
  return result.data;
}
export async function jsonBody(context: Context): Promise<unknown> {
  try { return await context.req.json(); }
  catch (error) { if (error instanceof SyntaxError) throw new ApiError("请求体不是合法的 JSON", 400); throw error; }
}
