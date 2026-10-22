import { ossBucketOrigin } from "./oss";
import { ApiError } from "../http/errors";

/** Validate references to immutable images created by the platform upload endpoint. */
export function validatePlatformImage(
  env: Env,
  image: string | null | undefined,
) {
  if (!image) return;
  const origin = ossBucketOrigin(env);
  const prefix = env.OSS_PREFIX.replace(/^\/+|\/+$/g, "");
  const base = `${origin}/${prefix}/images/`;
  if (
    !origin ||
    !image.startsWith(base) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/.test(
      image.slice(base.length),
    )
  ) {
    throw new ApiError("图片必须使用平台图片上传接口返回的地址", 400);
  }
}
