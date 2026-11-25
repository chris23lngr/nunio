/**
 * Whether `INTEGRATION_FAKES` is on: dev and test only, where it allows private mail hosts and the `nunio.test`
 * provider entry for the fakes (#280). Throws when set on a deployment, detected by the `VERCEL` or `RENDER`
 * variable those platforms set, so the API and worker refuse to start. `NODE_ENV` is not a signal: the e2e
 * suite runs the API with `NODE_ENV=production`.
 */
export function integrationFakes(env: NodeJS.ProcessEnv): boolean {
  if (env.INTEGRATION_FAKES && (env.VERCEL || env.RENDER))
    throw new Error("INTEGRATION_FAKES must not be set on a deployment");
  return env.INTEGRATION_FAKES === "true";
}
