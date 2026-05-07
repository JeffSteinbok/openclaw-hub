/**
 * Low-level JMAP HTTP client using fetch().
 *
 * Provides jmap() for executing JMAP method calls against Fastmail's API.
 */

const JMAP_API = "https://api.fastmail.com/jmap/api/";

const CAP_CORE = "urn:ietf:params:jmap:core";
const CAP_MAIL = "urn:ietf:params:jmap:mail";
const CAP_SUBMISSION = "urn:ietf:params:jmap:submission";

export const MAIL_CAPS = [CAP_CORE, CAP_MAIL, CAP_SUBMISSION];

export interface JmapResponse {
  methodResponses: [string, Record<string, unknown>, string][];
  [key: string]: unknown;
}

/**
 * Execute one or more JMAP method calls in a single round-trip.
 */
export async function jmap(
  token: string,
  calls: [string, Record<string, unknown>, string][],
  using?: string[],
): Promise<JmapResponse> {
  const payload = JSON.stringify({
    using: using ?? MAIL_CAPS,
    methodCalls: calls,
  });

  const resp = await fetch(JMAP_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload,
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`JMAP error ${resp.status}: ${body.slice(0, 500)}`);
  }

  return (await resp.json()) as JmapResponse;
}

/**
 * Upload a blob (e.g. MIME message) to Fastmail's upload endpoint.
 */
export async function uploadBlob(
  accountId: string,
  token: string,
  data: Uint8Array | string,
  contentType: string,
): Promise<{ blobId: string; [key: string]: unknown }> {
  const url = `https://api.fastmail.com/jmap/upload/${accountId}/`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
    },
    body: data,
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Upload error ${resp.status}: ${body.slice(0, 500)}`);
  }

  return (await resp.json()) as { blobId: string };
}

/**
 * Check a JMAP response for errors and throw on failures.
 */
export function checkJmapResponse(result: JmapResponse): void {
  for (const [name, data] of result.methodResponses) {
    if (name === "error") {
      throw new Error(
        `JMAP error [${name}]: ${(data as Record<string, string>).type}: ${(data as Record<string, string>).description ?? ""}`,
      );
    }
    for (const key of ["notCreated", "notUpdated", "notImported"]) {
      if (data[key] && Object.keys(data[key] as object).length > 0) {
        throw new Error(`${name} failed (${key}): ${JSON.stringify(data[key])}`);
      }
    }
  }
}
