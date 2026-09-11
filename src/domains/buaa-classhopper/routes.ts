import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import {
  errorResponse,
  methodNotAllowed,
  successResponse,
} from "../../http/response";
import type { AppEnv } from "../../http/types";
import {
  accessPolicyPatchSchema,
  formatAccessPolicyIssues,
} from "./access-policy.schema";
import { readAccessPolicy } from "./access-policy.repository";
import {
  AccessPolicyMutationError,
  RevisionConflictError,
  updateAccessPolicy,
} from "./access-policy.service";

export const PUBLIC_BUAA_CLASSHOPPER_BASE_PATH = "/api/buaa-classhopper";
export const ADMIN_BUAA_CLASSHOPPER_BASE_PATH =
  "/api/admin/buaa-classhopper";
export const ACCESS_POLICY_ROUTE_PATH = "/v1/iclass/access-policy";
export const PUBLIC_ACCESS_POLICY_PATH =
  `${PUBLIC_BUAA_CLASSHOPPER_BASE_PATH}${ACCESS_POLICY_ROUTE_PATH}`;
export const ADMIN_ACCESS_POLICY_PATH =
  `${ADMIN_BUAA_CLASSHOPPER_BASE_PATH}${ACCESS_POLICY_ROUTE_PATH}`;

export function createPublicBuaaClasshopperRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get(ACCESS_POLICY_ROUTE_PATH, async (context) => {
    const policy = await readAccessPolicy(context.env.API_PLATFORM_KV);
    if (policy === null) {
      return errorResponse("白名单尚未配置", 503);
    }

    return successResponse("获取成功", policy, 200, {
      "Cache-Control": "public, max-age=60",
    });
  });
  routes.all(ACCESS_POLICY_ROUTE_PATH, () => methodNotAllowed("GET"));

  return routes;
}

export function createAdminBuaaClasshopperRoutes(
  now: () => Date = () => new Date(),
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.patch(
    ACCESS_POLICY_ROUTE_PATH,
    bodyLimit({
      maxSize: 32 * 1024,
      onError: () =>
        errorResponse("请求体不能超过 32768 字节", 413, {
          headers: { "Cache-Control": "no-store" },
        }),
    }),
    zValidator("json", accessPolicyPatchSchema, (result) => {
      if (!result.success) {
        return errorResponse("请求数据格式错误", 400, {
          errors: formatAccessPolicyIssues(result.error.issues),
          headers: { "Cache-Control": "no-store" },
        });
      }
    }),
    async (context) => {
      const patch = context.req.valid("json");
      let result;
      try {
        result = await updateAccessPolicy(
          context.env.API_PLATFORM_KV,
          patch,
          now(),
        );
      } catch (error) {
        if (error instanceof RevisionConflictError) {
          return errorResponse(error.message, 409, {
            data: { currentRevision: error.currentRevision },
            headers: { "Cache-Control": "no-store" },
          });
        }
        if (error instanceof AccessPolicyMutationError) {
          return errorResponse(error.message, 400, {
            errors: error.details,
            headers: { "Cache-Control": "no-store" },
          });
        }
        throw error;
      }

      if (result === null) {
        return errorResponse("白名单尚未配置", 503, {
          headers: { "Cache-Control": "no-store" },
        });
      }

      const identity = context.get("accessIdentity");
      console.log(
        JSON.stringify({
          message: result.changed
            ? "access policy updated"
            : "access policy patch was a no-op",
          path: context.req.path,
          previousRevision: result.previousRevision,
          revision: result.policy.revision,
          addedCount: result.changes.added,
          removedCount: result.changes.removed,
          actorEmail: identity.email,
          actorSubject: identity.subject,
        }),
      );

      return successResponse(
        result.changed ? "更新成功" : "未发生变更",
        result.policy,
        200,
        { "Cache-Control": "no-store" },
      );
    },
  );
  routes.all(ACCESS_POLICY_ROUTE_PATH, () => methodNotAllowed("PATCH"));

  return routes;
}
