/**
 * github.ts — File a GitHub issue when all recovery attempts fail.
 */

import { GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME, log } from "./config.js";

export async function fileIncidentIssue(doctorOutput: string): Promise<string | null> {
  if (!GITHUB_TOKEN) {
    log("ERROR: GITHUB_TOKEN not set — cannot file issue");
    return null;
  }

  const now = new Date().toISOString();
  const title = `🚨 Gateway down and stuck after config change (${now})`;
  const body = [
    "## OpenClaw Gateway — Auto-Recovery Failed",
    "",
    "The `config-watchdog` service detected a config change that took the gateway down.",
    "All recovery attempts have been exhausted:",
    "",
    "1. ✅ Rotated in last-known-good config → gateway still down",
    "2. ✅ Ran `openclaw doctor fix` + restarted → gateway still down",
    "3. 🛑 Manual intervention required",
    "",
    `**Time:** ${now}`,
    "",
    "## `openclaw doctor` output",
    "",
    "```",
    doctorOutput.slice(0, 12_000), // GitHub issue body limit safety
    "```",
  ].join("\n");

  const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title,
        body,
        labels: ["bug", "incident"],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      log(`ERROR: GitHub issue creation failed ${res.status}: ${text}`);
      return null;
    }

    const data = (await res.json()) as { html_url: string; number: number };
    log(`incident issue filed: #${data.number} ${data.html_url}`);
    return data.html_url;
  } catch (e) {
    log(`ERROR: failed to file GitHub issue: ${e}`);
    return null;
  }
}
