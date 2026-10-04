import { app } from "./app";
import { IclassCheckinWorkflow, reconcileWorkflows } from "./domains/buaa-classhopper/reservations/workflow";

export { IclassCheckinWorkflow };

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(reconcileWorkflows(env));
  },
} satisfies ExportedHandler<Env>;
