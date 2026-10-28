import { health } from "../src/health.js";

/** GET /api/health: liveness check for uptime monitors, never cached. */
export function GET(): Response {
  return Response.json(health(), { headers: { "cache-control": "no-store" } });
}
