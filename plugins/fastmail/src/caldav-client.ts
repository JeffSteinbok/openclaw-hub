/**
 * CalDAV HTTP client (RFC 4791/4918).
 *
 * Uses fetch() for HTTP, manual XML building/parsing with string templates.
 * Ported from caldav_client.py.
 */

// ── XML namespace constants ─────────────────────────────────────────────────

const NS_DAV = "DAV:";
const NS_CALDAV = "urn:ietf:params:xml:ns:caldav";

// ── Exceptions ──────────────────────────────────────────────────────────────

export class CalDAVError extends Error {
  statusCode: number | null;
  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = "CalDAVError";
    this.statusCode = statusCode;
  }
}

// ── iCalendar parsing helpers ───────────────────────────────────────────────

function icalUnescape(s: string): string {
  const result: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const nxt = s[i + 1];
      if (nxt === "n" || nxt === "N") {
        result.push("\n");
      } else if (nxt === ",") {
        result.push(",");
      } else if (nxt === ";") {
        result.push(";");
      } else if (nxt === "\\") {
        result.push("\\");
      } else {
        result.push("\\");
        result.push(nxt);
      }
      i += 2;
    } else {
      result.push(s[i]);
      i += 1;
    }
  }
  return result.join("");
}

export interface IcalAttendee {
  email: string;
  name: string;
  partstat: string;
  rsvp: boolean;
}

export interface IcalEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
  duration: string;
  location: string;
  description: string;
  organizer: string;
  status: string;
  sequence: number;
  attendees: IcalAttendee[];
  href?: string;
  etag?: string;
  ical?: string;
}

/**
 * Extract key fields from a VCALENDAR/VEVENT iCalendar string.
 */
export function parseIcalEvent(icalData: string): IcalEvent {
  // Unfold continuation lines (RFC 5545 §3.1)
  const unfolded = icalData.replace(/\r?\n[ \t]/g, "");

  const result: IcalEvent = {
    uid: "",
    summary: "",
    dtstart: "",
    dtend: "",
    duration: "",
    location: "",
    description: "",
    organizer: "",
    status: "",
    sequence: 0,
    attendees: [],
  };
  const attendees: IcalAttendee[] = [];
  let inVevent = false;

  for (const rawLine of unfolded.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "BEGIN:VEVENT") {
      inVevent = true;
      continue;
    }
    if (line === "END:VEVENT") {
      break;
    }
    if (!inVevent || !line.includes(":")) {
      continue;
    }

    const colonIdx = line.indexOf(":");
    const namePart = line.slice(0, colonIdx);
    const value = icalUnescape(line.slice(colonIdx + 1));
    const propName = namePart.split(";")[0].toUpperCase();

    // Parse parameters
    const params: Record<string, string> = {};
    const paramStr = namePart.slice(propName.length);
    if (paramStr.startsWith(";")) {
      for (const seg of paramStr.slice(1).split(";")) {
        const eqIdx = seg.indexOf("=");
        if (eqIdx >= 0) {
          params[seg.slice(0, eqIdx).toUpperCase()] = seg.slice(eqIdx + 1).replace(/^"|"$/g, "");
        }
      }
    }

    switch (propName) {
      case "UID":
        result.uid = value;
        break;
      case "SUMMARY":
        result.summary = value;
        break;
      case "DTSTART":
        result.dtstart = value;
        break;
      case "DTEND":
        result.dtend = value;
        break;
      case "DURATION":
        result.duration = value;
        break;
      case "LOCATION":
        result.location = value;
        break;
      case "DESCRIPTION":
        result.description = value;
        break;
      case "STATUS":
        result.status = value.toLowerCase();
        break;
      case "SEQUENCE":
        result.sequence = parseInt(value, 10) || 0;
        break;
      case "ORGANIZER":
        result.organizer = value.replace(/^mailto:/i, "");
        break;
      case "ATTENDEE":
        attendees.push({
          email: value.replace(/^mailto:/i, ""),
          name: params.CN ?? "",
          partstat: params.PARTSTAT ?? "NEEDS-ACTION",
          rsvp: (params.RSVP ?? "FALSE").toUpperCase() === "TRUE",
        });
        break;
    }
  }

  result.attendees = attendees;
  return result;
}

/**
 * Patch specific properties inside a VCALENDAR string.
 */
export function updateIcalVevent(
  icalData: string,
  patches: Record<string, string | { params?: string; value: string } | null>,
): string {
  const text = icalData.replace(/\r\n/g, "\n");
  const unfolded = text.replace(/\n[ \t]/g, "");

  function formatPatchLine(
    prop: string,
    patch: string | { params?: string; value: string },
    existingLine?: string,
  ): string {
    if (typeof patch === "object" && patch !== null) {
      const params = patch.params ?? "";
      return `${prop}${params}:${patch.value}`;
    }
    let params = "";
    if (existingLine) {
      const head = existingLine.split(":")[0];
      if (head.includes(";")) {
        params = head.slice(prop.length);
      }
    }
    return `${prop}${params}:${patch}`;
  }

  const outLines: string[] = [];
  let inVevent = false;
  const handledKeys = new Set<string>();

  for (const line of unfolded.split("\n")) {
    if (line === "BEGIN:VEVENT") {
      inVevent = true;
      outLines.push(line);
      continue;
    }

    if (line === "END:VEVENT") {
      inVevent = false;
      // Append any patches not yet encountered
      for (const [prop, val] of Object.entries(patches)) {
        if (!handledKeys.has(prop) && val !== null) {
          outLines.push(formatPatchLine(prop, val));
        }
      }
      outLines.push(line);
      continue;
    }

    if (!inVevent) {
      outLines.push(line);
      continue;
    }

    const propName = line.split(";")[0].split(":")[0].toUpperCase();

    if (propName in patches) {
      handledKeys.add(propName);
      if (patches[propName] !== null) {
        outLines.push(formatPatchLine(propName, patches[propName]!, line));
      }
      // null means remove
    } else {
      outLines.push(line);
    }
  }

  return outLines.join("\r\n");
}

// ── Simple XML parsing helpers ──────────────────────────────────────────────

/**
 * Extract text content for a given XML tag from raw XML string.
 * Returns all matches as an array.
 */
function extractXmlValues(xml: string, localName: string): string[] {
  const results: string[] = [];
  // Match both prefixed and non-prefixed forms
  const patterns = [
    new RegExp(`<(?:[a-zA-Z0-9]+:)?${localName}[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${localName}>`, "g"),
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(xml)) !== null) {
      results.push(match[1].trim());
    }
  }
  return results;
}

interface MultstatusResponse {
  href: string;
  etag: string;
  calendarData: string;
  displayName: string;
  isCalendar: boolean;
  description: string;
  color: string;
}

function parseMultistatus(xml: string): MultstatusResponse[] {
  const results: MultstatusResponse[] = [];
  // Split on <d:response> or <D:response> or <response xmlns="DAV:">
  const responseRegex = /<(?:[a-zA-Z0-9]+:)?response[\s>][\s\S]*?<\/(?:[a-zA-Z0-9]+:)?response>/gi;
  const responses = xml.match(responseRegex) ?? [];

  for (const respBlock of responses) {
    const hrefMatches = extractXmlValues(respBlock, "href");
    const href = hrefMatches[0] ?? "";

    const etagMatches = extractXmlValues(respBlock, "getetag");
    const etag = (etagMatches[0] ?? "").replace(/^"|"$/g, "");

    const calDataMatches = extractXmlValues(respBlock, "calendar-data");
    const calendarData = calDataMatches[0] ?? "";

    const displayNameMatches = extractXmlValues(respBlock, "displayname");
    const displayName = displayNameMatches[0] ?? "";

    const descMatches = extractXmlValues(respBlock, "calendar-description");
    const description = descMatches[0] ?? "";

    const colorMatches = extractXmlValues(respBlock, "calendar-color");
    const color = colorMatches[0] ?? "";

    const isCalendar = /<(?:[a-zA-Z0-9]+:)?calendar\s*\/>/.test(respBlock) ||
      /<(?:[a-zA-Z0-9]+:)?calendar>/.test(respBlock);

    results.push({ href, etag, calendarData, displayName, isCalendar, description, color });
  }
  return results;
}

// ── CalDAV Client ───────────────────────────────────────────────────────────

export class CalDAVClient {
  baseUrl: string;
  username: string;
  password: string;
  timeout: number;
  private _auth: string;

  constructor(baseUrl: string, username: string, password: string, timeout = 30) {
    this.baseUrl = baseUrl.replace(/\/+$/, "") + "/";
    this.username = username;
    this.password = password;
    this.timeout = timeout;
    this._auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  }

  private _url(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return this.baseUrl + path.replace(/^\/+/, "");
  }

  private async _request(
    method: string,
    path: string,
    headers?: Record<string, string>,
    body?: string | Uint8Array,
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const allHeaders: Record<string, string> = { Authorization: this._auth };
    if (headers) {
      Object.assign(allHeaders, headers);
    }

    const url = this._url(path);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout * 1000);

    try {
      const resp = await fetch(url, {
        method,
        headers: allHeaders,
        body: body ?? undefined,
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timeoutId);

      const respBody = await resp.text();
      if (resp.status >= 400) {
        throw new CalDAVError(
          `HTTP ${resp.status} for ${method} ${url}: ${respBody.slice(0, 200)}`,
          resp.status,
        );
      }

      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        respHeaders[k] = v;
      });

      return { status: resp.status, headers: respHeaders, body: respBody };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof CalDAVError) throw err;
      throw new CalDAVError(
        `Request failed for ${method} ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Raw WebDAV / CalDAV operations ──────────────────────────────────────

  async propfind(path: string, depth = "1", body?: string): Promise<string> {
    const xmlBody =
      body ??
      '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>';
    const resp = await this._request("PROPFIND", path, {
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8",
    }, xmlBody);
    return resp.body;
  }

  async put(path: string, icalData: string, etag?: string): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "text/calendar; charset=utf-8",
    };
    if (etag !== undefined) {
      if (etag === "*") {
        headers["If-None-Match"] = "*";
      } else {
        const quoted = etag.startsWith('"') ? etag : `"${etag}"`;
        headers["If-Match"] = quoted;
      }
    }
    const resp = await this._request("PUT", path, headers, icalData);
    return (resp.headers.etag ?? "").replace(/^"|"$/g, "");
  }

  async delete(path: string, etag?: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (etag) {
      headers["If-Match"] = etag;
    }
    await this._request("DELETE", path, Object.keys(headers).length > 0 ? headers : undefined);
  }

  async report(path: string, reportXml: string, depth = "1"): Promise<string> {
    const resp = await this._request("REPORT", path, {
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8",
    }, reportXml);
    return resp.body;
  }

  // ── High-level calendar operations ─────────────────────────────────────

  async discoverCalendars(path?: string): Promise<Array<{ href: string; displayName: string; description: string; color: string }>> {
    const propfindBody = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:i="http://apple.com/ns/ical/">',
      "  <d:prop>",
      "    <d:displayname/>",
      "    <d:resourcetype/>",
      "    <c:calendar-description/>",
      "    <i:calendar-color/>",
      "  </d:prop>",
      "</d:propfind>",
    ].join("\n");

    const pathsToTry = path
      ? [path]
      : [
          `/dav/calendars/user/${this.username}/`,
          "/.well-known/caldav",
          "",
        ];

    let xmlResp: string | null = null;
    for (const tryPath of pathsToTry) {
      try {
        xmlResp = await this.propfind(tryPath, "1", propfindBody);
        break;
      } catch {
        continue;
      }
    }
    if (!xmlResp) return [];

    const responses = parseMultistatus(xmlResp);
    return responses
      .filter((r) => r.isCalendar)
      .map((r) => ({
        href: r.href,
        displayName: r.displayName,
        description: r.description,
        color: r.color,
      }));
  }

  async getCalendarEvents(
    calendarPath: string,
    start?: Date,
    end?: Date,
  ): Promise<IcalEvent[]> {
    let timeRangeXml = "";
    if (start || end) {
      const attrs: string[] = [];
      if (start) attrs.push(`start="${formatUtcDate(start)}"`);
      if (end) attrs.push(`end="${formatUtcDate(end)}"`);
      timeRangeXml = `<c:time-range ${attrs.join(" ")}/>`;
    }

    const reportXml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<c:calendar-query xmlns:d="${NS_DAV}" xmlns:c="${NS_CALDAV}">`,
      "  <d:prop>",
      "    <d:href/>",
      "    <d:getetag/>",
      "    <c:calendar-data/>",
      "  </d:prop>",
      "  <c:filter>",
      '    <c:comp-filter name="VCALENDAR">',
      '      <c:comp-filter name="VEVENT">',
      timeRangeXml ? `        ${timeRangeXml}` : "",
      "      </c:comp-filter>",
      "    </c:comp-filter>",
      "  </c:filter>",
      "</c:calendar-query>",
    ].filter(Boolean).join("\n");

    try {
      const xmlResp = await this.report(calendarPath, reportXml);
      return parseEventMultistatus(xmlResp);
    } catch {
      return [];
    }
  }

  async getEventByUid(calendarPath: string, uid: string): Promise<IcalEvent | null> {
    const reportXml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<c:calendar-query xmlns:d="${NS_DAV}" xmlns:c="${NS_CALDAV}">`,
      "  <d:prop>",
      "    <d:href/>",
      "    <d:getetag/>",
      "    <c:calendar-data/>",
      "  </d:prop>",
      "  <c:filter>",
      '    <c:comp-filter name="VCALENDAR">',
      '      <c:comp-filter name="VEVENT">',
      '        <c:prop-filter name="UID">',
      `          <c:text-match collation="i;octet">${escapeXml(uid)}</c:text-match>`,
      "        </c:prop-filter>",
      "      </c:comp-filter>",
      "    </c:comp-filter>",
      "  </c:filter>",
      "</c:calendar-query>",
    ].join("\n");

    try {
      const xmlResp = await this.report(calendarPath, reportXml);
      const events = parseEventMultistatus(xmlResp);
      return events[0] ?? null;
    } catch {
      return null;
    }
  }

  async createEvent(calendarPath: string, uid: string, icalData: string): Promise<string> {
    const safeUid = uid.replace(/[^a-zA-Z0-9._-]/g, "_");
    const resourcePath = calendarPath.replace(/\/+$/, "") + `/${safeUid}.ics`;
    await this.put(resourcePath, icalData, "*");
    return resourcePath;
  }

  async updateEvent(eventHref: string, icalData: string, etag?: string): Promise<string> {
    return this.put(eventHref, icalData, etag);
  }

  async deleteEvent(eventHref: string, etag?: string): Promise<void> {
    await this.delete(eventHref, etag);
  }
}

// ── Utility functions ───────────────────────────────────────────────────────

function formatUtcDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseEventMultistatus(xml: string): IcalEvent[] {
  const responses = parseMultistatus(xml);
  const events: IcalEvent[] = [];

  for (const resp of responses) {
    if (!resp.calendarData) continue;
    const parsed = parseIcalEvent(resp.calendarData);
    parsed.href = resp.href;
    parsed.etag = resp.etag;
    parsed.ical = resp.calendarData;
    events.push(parsed);
  }
  return events;
}
