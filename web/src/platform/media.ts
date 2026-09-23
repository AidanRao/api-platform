import { z } from "zod";
import { platformClient } from "./api";

export function uploadImage(file: File) {
  return platformClient("/media/images", z.object({ url: z.string().url() }), {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
}
