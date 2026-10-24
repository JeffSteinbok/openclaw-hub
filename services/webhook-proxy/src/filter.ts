/**
 * filter.ts — Per-route event filters, applied after auth and before forwarding.
 *
 * A filter decides whether an authenticated event is worth waking an agent for.
 * Dropped events are acknowledged with 204 so the sender doesn't retry.
 */

import type { IncomingHttpHeaders } from "node:http";
import type { RouteFilter } from "./config.js";

export type FilterResult = { forward: true } | { forward: false; reason: string };

/**
 * GitHub issues filter. Mirrors the Gateway transform
 * (~/.openclaw/hooks/transforms/github-issues.js) so the proxy drops what the
 * transform would drop, without the event ever reaching OpenClaw.
 */
function githubIssues(
  filter: Extract<RouteFilter, { type: "github-issues" }>,
  headers: IncomingHttpHeaders,
  body: Buffer,
): FilterResult {
  const eventHeader = headers["x-github-event"];
  const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;
  if (event === "ping") return { forward: false, reason: "ping" };

  let payload: {
    action?: unknown;
    sender?: { login?: unknown };
    label?: { name?: unknown };
  };
  try {
    payload = JSON.parse(body.toString("utf-8"));
  } catch {
    return { forward: false, reason: "invalid_json" };
  }

  const sender = payload?.sender?.login;
  if (typeof sender !== "string") return { forward: false, reason: "missing_sender" };
  if (!filter.allowedSenders.includes(sender)) {
    return { forward: false, reason: "unauthorized_sender" };
  }
  if (event !== "issues") return { forward: false, reason: "unhandled_event" };

  const label = payload?.label?.name;
  if (
    payload.action !== "labeled" ||
    typeof label !== "string" ||
    !filter.actionableLabels.includes(label)
  ) {
    return { forward: false, reason: "not_actionable" };
  }
  return { forward: true };
}

export function applyFilter(
  filter: RouteFilter | undefined,
  headers: IncomingHttpHeaders,
  body: Buffer,
): FilterResult {
  if (!filter) return { forward: true };
  switch (filter.type) {
    case "github-issues":
      return githubIssues(filter, headers, body);
    default:
      // Unknown filter types fail closed: a typo must not open the route.
      return { forward: false, reason: "unknown_filter_type" };
  }
}
