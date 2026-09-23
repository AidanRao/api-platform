import { z } from "zod";

// Public app metadata shared with the admin client; the registry stays on the server.
export const appSchema = z.object({ id: z.string(), name: z.string() });
export const appListSchema = z.object({ items: z.array(appSchema) });
export type AppDefinition = Readonly<z.infer<typeof appSchema>>;
