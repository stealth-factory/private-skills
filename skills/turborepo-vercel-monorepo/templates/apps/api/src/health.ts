export interface Health {
  status: "ok";
  service: "__SCOPE__-api";
  version: string;
}

/** Liveness payload. `version` is the deployed commit on Vercel and "dev" locally. */
export function health(env: NodeJS.ProcessEnv = process.env): Health {
  return { status: "ok", service: "__SCOPE__-api", version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev" };
}
