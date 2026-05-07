/**
 * Email sending, meeting creation, event update/query via JMAP + CalDAV.
 *
 * Ported from fastmail.py.
 */

import { randomUUID } from "node:crypto";
import { jmap, uploadBlob, checkJmapResponse, MAIL_CAPS } from "./jmap-client.js";
import {
  CalDAVClient,
  CalDAVError,
  parseIcalEvent,
  updateIcalVevent,
  type IcalEvent,
  type IcalAttendee,
} from "./caldav-client.js";
import type { FastmailConfig } from "./config.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function icalEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function durationToMinutes(d: string): number {
  const s = d.toLowerCase().trim();
  if (s.endsWith("h")) return Math.round(parseFloat(s.slice(0, -1)) * 60);
  if (s.endsWith("m")) return parseInt(s.slice(0, -1), 10);
  const n = parseInt(s, 10);
  if (isNaN(n)) throw new Error(`Invalid duration: '${d}' (use e.g. '1h', '30m', '1.5h')`);
  return n;
}

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIcalDt(d: Date): string {
  return (
    d.getFullYear().toString() +
    padTwo(d.getMonth() + 1) +
    padTwo(d.getDate()) +
    "T" +
    padTwo(d.getHours()) +
    padTwo(d.getMinutes()) +
    padTwo(d.getSeconds())
  );
}

function formatIcalStamp(): string {
  const now = new Date();
  return (
    now.getUTCFullYear().toString() +
    padTwo(now.getUTCMonth() + 1) +
    padTwo(now.getUTCDate()) +
    "T" +
    padTwo(now.getUTCHours()) +
    padTwo(now.getUTCMinutes()) +
    padTwo(now.getUTCSeconds()) +
    "Z"
  );
}

function bodyWithSig(content: string, signature?: string): string {
  return signature ? `${content}\n\n${signature}` : content;
}

function buildSubmitCall(
  cfg: FastmailConfig,
  emailRef: string,
  recipients: string[],
): [string, Record<string, unknown>, string] {
  return [
    "EmailSubmission/set",
    {
      accountId: cfg.accountId,
      create: {
        s: {
          emailId: emailRef,
          identityId: cfg.identityId,
          envelope: {
            mailFrom: { email: cfg.fromEmail },
            rcptTo: recipients.map((e) => ({ email: e })),
          },
        },
      },
      onSuccessUpdateEmail: {
        "#s": {
          [`mailboxIds/${cfg.draftsId}`]: null,
          [`mailboxIds/${cfg.sentId}`]: true,
          "keywords/$seen": true,
        },
      },
    },
    "submit",
  ];
}

function buildIcalVevent(opts: {
  uid: string;
  subject: string;
  start: Date;
  end: Date;
  timezone: string;
  fromName: string;
  fromEmail: string;
  location?: string;
  description?: string;
  attendees?: string[];
  sequence?: number;
  method?: string;
}): string {
  const stamp = formatIcalStamp();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Octo//OpenClaw//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${opts.method ?? "REQUEST"}`,
    "BEGIN:VEVENT",
    `DTSTART;TZID=${opts.timezone}:${formatIcalDt(opts.start)}`,
    `DTEND;TZID=${opts.timezone}:${formatIcalDt(opts.end)}`,
    `DTSTAMP:${stamp}`,
    `UID:${opts.uid}`,
    `SUMMARY:${icalEscape(opts.subject)}`,
    `SEQUENCE:${opts.sequence ?? 0}`,
    "STATUS:CONFIRMED",
    `ORGANIZER;CN=${opts.fromName}:mailto:${opts.fromEmail}`,
  ];
  if (opts.location) {
    lines.push(`LOCATION:${icalEscape(opts.location)}`);
  }
  if (opts.description) {
    lines.push(`DESCRIPTION:${icalEscape(opts.description)}`);
  }
  for (const addr of opts.attendees ?? []) {
    lines.push(
      `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:${addr}`,
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

// ── MIME helper ─────────────────────────────────────────────────────────────

function buildMimeMessage(opts: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments?: Array<{ filename: string; contentType: string; data: Uint8Array }>;
}): string {
  const boundary = `----=_Part_${randomUUID().replace(/-/g, "")}`;
  const msgId = `<${randomUUID()}@${opts.from.includes("@") ? opts.from.split("@")[1] : "localhost"}>`;
  const date = new Date().toUTCString();

  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(", ")}`,
    ...(opts.cc && opts.cc.length > 0 ? [`Cc: ${opts.cc.join(", ")}`] : []),
    `Subject: ${opts.subject}`,
    `Date: ${date}`,
    `Message-ID: ${msgId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];

  const parts: string[] = [];
  // Text body part
  parts.push(
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: 8bit\r\n` +
    `\r\n` +
    opts.body,
  );

  // Attachment parts
  for (const att of opts.attachments ?? []) {
    const b64 = Buffer.from(att.data).toString("base64");
    // Fold base64 at 76 chars
    const folded = b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: ${att.contentType}\r\n` +
      `Content-Transfer-Encoding: base64\r\n` +
      `Content-Disposition: attachment; filename="${att.filename}"\r\n` +
      `\r\n` +
      folded,
    );
  }

  parts.push(`--${boundary}--`);

  return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n");
}

// ── CalDAV helper ───────────────────────────────────────────────────────────

function getCaldavClient(cfg: FastmailConfig): CalDAVClient | null {
  if (cfg.caldavUrl && cfg.caldavUsername && cfg.caldavPassword) {
    return new CalDAVClient(cfg.caldavUrl, cfg.caldavUsername, cfg.caldavPassword);
  }
  return null;
}

async function getCaldavCalendarPath(
  cfg: FastmailConfig,
  client: CalDAVClient,
): Promise<string> {
  if (cfg.caldavCalendarPath) return cfg.caldavCalendarPath;
  const calendars = await client.discoverCalendars();
  if (calendars.length === 0) {
    throw new Error(
      "CalDAV: no calendars discovered at the configured base URL. Set caldavCalendarPath explicitly.",
    );
  }
  return calendars[0].href;
}

// ── Event formatting ────────────────────────────────────────────────────────

const PARTSTAT_ICON: Record<string, string> = {
  accepted: "✓",
  declined: "✗",
  tentative: "?",
  "needs-action": "·",
  delegated: "→",
};

function formatTime12h(raw: string): string {
  const fmts = [
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/,
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z?$/,
  ];
  for (const fmt of fmts) {
    const m = raw.match(fmt);
    if (m) {
      const d = new Date(
        parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
        parseInt(m[4]), parseInt(m[5]), parseInt(m[6]),
      );
      const dayStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const hr = d.getHours() % 12 || 12;
      const min = padTwo(d.getMinutes());
      const ampm = d.getHours() >= 12 ? "PM" : "AM";
      return `${dayStr} ${hr}:${min} ${ampm}`;
    }
  }
  return raw;
}

function formatEventBlock(ev: {
  title: string;
  dtstart: string;
  dtend: string;
  duration: string;
  location: string;
  uid: string;
  attendees: IcalAttendee[];
  backend?: string;
}): string {
  const lines: string[] = [`📅 ${ev.title}`];
  const startFmt = formatTime12h(ev.dtstart);
  let timePart: string;
  if (ev.dtend) {
    const endFmt = formatTime12h(ev.dtend);
    timePart = `${startFmt}–${endFmt}`;
  } else if (ev.duration) {
    timePart = `${startFmt} (${ev.duration})`;
  } else {
    timePart = startFmt;
  }
  lines.push(`   Date:     ${timePart}`);
  if (ev.location) lines.push(`   Location: ${ev.location}`);
  if (ev.uid) lines.push(`   UID:      ${ev.uid}`);
  if (ev.backend) lines.push(`   Backend:  ${ev.backend}`);
  if (ev.attendees.length > 0) {
    lines.push("   Attendees:");
    for (const att of ev.attendees) {
      const icon = PARTSTAT_ICON[att.partstat.toLowerCase()] ?? "·";
      const label = att.name || att.email || "?";
      lines.push(`     ${icon} ${label} <${att.email}> (${att.partstat})`);
    }
  }
  return lines.join("\n");
}

// ── Public command functions ────────────────────────────────────────────────

export interface SendArgs {
  to: string | string[];
  cc?: string[];
  subject: string;
  body: string;
  signature?: string;
  attachment?: string[];
}

export async function cmdSend(cfg: FastmailConfig, args: SendArgs): Promise<string> {
  const toList = Array.isArray(args.to) ? args.to : [args.to];
  const ccList = args.cc ?? [];
  const recipients = [...toList, ...ccList];

  if (!args.attachment || args.attachment.length === 0) {
    // Fast path: native JMAP Email/set
    const emailObj: Record<string, unknown> = {
      mailboxIds: { [cfg.draftsId]: true },
      from: [{ name: cfg.fromName, email: cfg.fromEmail }],
      to: toList.map((e) => ({ email: e })),
      subject: args.subject,
      bodyStructure: { type: "text/plain", partId: "1" },
      bodyValues: { "1": { value: bodyWithSig(args.body, args.signature) } },
    };
    if (ccList.length > 0) {
      emailObj.cc = ccList.map((e) => ({ email: e }));
    }

    const result = await jmap(cfg.jmapToken, [
      ["Email/set", { accountId: cfg.accountId, create: { e: emailObj } }, "create"],
      buildSubmitCall(cfg, "#e", recipients),
    ]);
    checkJmapResponse(result);
  } else {
    // MIME path for attachments — read files
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");
    const attachments: Array<{ filename: string; contentType: string; data: Uint8Array }> = [];
    for (const filepath of args.attachment) {
      const data = await readFile(filepath);
      const ext = filepath.split(".").pop() ?? "";
      const ctMap: Record<string, string> = {
        pdf: "application/pdf",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        txt: "text/plain",
        csv: "text/csv",
        json: "application/json",
        zip: "application/zip",
      };
      attachments.push({
        filename: basename(filepath),
        contentType: ctMap[ext.toLowerCase()] ?? "application/octet-stream",
        data,
      });
    }

    const mime = buildMimeMessage({
      from: `${cfg.fromName} <${cfg.fromEmail}>`,
      to: toList,
      cc: ccList.length > 0 ? ccList : undefined,
      subject: args.subject,
      body: bodyWithSig(args.body, args.signature),
      attachments,
    });

    const blob = await uploadBlob(
      cfg.accountId,
      cfg.jmapToken,
      mime,
      "message/rfc822",
    );
    const result = await jmap(cfg.jmapToken, [
      [
        "Email/import",
        {
          accountId: cfg.accountId,
          emails: { m: { blobId: blob.blobId, mailboxIds: { [cfg.draftsId]: true } } },
        },
        "import",
      ],
      buildSubmitCall(cfg, "#m", recipients),
    ]);
    checkJmapResponse(result);
  }

  const attNote = args.attachment?.length ? ` (${args.attachment.length} attachment(s))` : "";
  return `✓ Sent to ${toList.join(", ")}: ${args.subject}${attNote}`;
}

export interface MeetingArgs {
  to: string | string[];
  cc?: string[];
  subject: string;
  start: string;
  duration?: string;
  location?: string;
  description?: string;
  timezone?: string;
  signature?: string;
}

export async function cmdMeeting(cfg: FastmailConfig, args: MeetingArgs): Promise<string> {
  const startDt = new Date(args.start);
  if (isNaN(startDt.getTime())) {
    throw new Error(
      `Invalid start datetime: '${args.start}' (use ISO format, e.g. 2026-03-15T14:00)`,
    );
  }

  const mins = durationToMinutes(args.duration ?? "1h");
  const endDt = new Date(startDt.getTime() + mins * 60_000);
  const tz = args.timezone ?? "America/Los_Angeles";
  const domain = cfg.fromEmail.includes("@") ? cfg.fromEmail.split("@")[1] : "localhost";
  const uid = `${randomUUID()}@${domain}`;
  const toList = Array.isArray(args.to) ? args.to : [args.to];
  const allAttendees = [...toList, ...(args.cc ?? [])];

  const caldav = getCaldavClient(cfg);
  if (!caldav) {
    throw new Error("CalDAV not configured. Set caldavUrl, caldavUsername, and caldavPassword.");
  }

  const icalStr = buildIcalVevent({
    uid,
    subject: args.subject,
    start: startDt,
    end: endDt,
    timezone: tz,
    fromName: cfg.fromName,
    fromEmail: cfg.fromEmail,
    location: args.location,
    description: args.description,
    attendees: allAttendees,
  });

  const calPath = await getCaldavCalendarPath(cfg, caldav);
  const resourcePath = await caldav.createEvent(calPath, uid, icalStr);

  const lines: string[] = [];
  lines.push(`✓ Calendar event created via CalDAV (server sends iMIP invites): ${args.subject}`);
  const hrStart = startDt.getHours() % 12 || 12;
  const hrEnd = endDt.getHours() % 12 || 12;
  const ampmStart = startDt.getHours() >= 12 ? "PM" : "AM";
  const ampmEnd = endDt.getHours() >= 12 ? "PM" : "AM";
  lines.push(
    `  ${startDt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${hrStart}:${padTwo(startDt.getMinutes())} ${ampmStart}–${hrEnd}:${padTwo(endDt.getMinutes())} ${ampmEnd} ${tz}`,
  );
  if (args.location) lines.push(`  Location: ${args.location}`);
  lines.push(`  UID: ${uid}`);
  lines.push(`  Resource: ${resourcePath}`);

  return lines.join("\n");
}

export interface UpdateEventArgs {
  uid?: string;
  find?: string;
  new_title?: string;
  new_start?: string;
  new_duration?: string;
  new_location?: string;
  new_description?: string;
  timezone?: string;
  status?: string;
  add_attendee?: string[];
  remove_attendee?: string[];
  force?: boolean;
}

export async function cmdUpdateEvent(
  cfg: FastmailConfig,
  args: UpdateEventArgs,
): Promise<string> {
  const caldav = getCaldavClient(cfg);
  if (!caldav) {
    throw new Error("CalDAV not configured. Set caldavUrl, caldavUsername, and caldavPassword.");
  }
  if (!args.uid && !args.find) {
    throw new Error("Provide uid or find to identify the event.");
  }

  const calPath = await getCaldavCalendarPath(cfg, caldav);
  let events: IcalEvent[];

  if (args.uid) {
    const ev = await caldav.getEventByUid(calPath, args.uid);
    if (!ev) throw new Error(`No event found with UID: ${args.uid}`);
    events = [ev];
  } else {
    const allEvents = await caldav.getCalendarEvents(calPath);
    const needle = args.find!.toLowerCase();
    events = allEvents.filter(
      (e) =>
        e.summary.toLowerCase().includes(needle) ||
        e.description.toLowerCase().includes(needle),
    );
    if (events.length === 0) throw new Error(`No event found matching: '${args.find}'`);
    if (events.length > 1 && !args.force) {
      const summaries = events
        .map((e) => `  uid=${e.uid}  title='${e.summary}'  start=${e.dtstart}`)
        .join("\n");
      throw new Error(
        `Found ${events.length} matching events:\n${summaries}\nRe-run with uid to target a specific one, or pass force=true to update all.`,
      );
    }
  }

  // Build patches
  const tz = args.timezone ?? "America/Los_Angeles";
  const icalPatches: Record<string, string | { params?: string; value: string } | null> = {};

  if (args.new_title) icalPatches.SUMMARY = args.new_title;
  if (args.new_description) icalPatches.DESCRIPTION = args.new_description;
  if (args.new_location) icalPatches.LOCATION = args.new_location;

  if (args.new_start) {
    const newStart = new Date(args.new_start);
    if (isNaN(newStart.getTime())) throw new Error(`Invalid new_start: '${args.new_start}'`);
    icalPatches.DTSTART = {
      params: `;TZID=${tz}`,
      value: formatIcalDt(newStart),
    };
  }

  if (args.new_duration) {
    const mins = durationToMinutes(args.new_duration);
    let baseStart: Date;
    if (args.new_start) {
      baseStart = new Date(args.new_start);
    } else if (events.length > 0 && events[0].dtstart) {
      baseStart = new Date(events[0].dtstart);
      if (isNaN(baseStart.getTime())) baseStart = new Date();
    } else {
      baseStart = new Date();
    }
    const newEnd = new Date(baseStart.getTime() + mins * 60_000);
    if (args.new_start) {
      icalPatches.DTEND = {
        params: `;TZID=${tz}`,
        value: formatIcalDt(newEnd),
      };
    } else {
      icalPatches.DTEND = formatIcalDt(newEnd);
    }
  }

  if (args.status) {
    icalPatches.STATUS = args.status.toUpperCase();
  }

  if (
    Object.keys(icalPatches).length === 0 &&
    !args.add_attendee?.length &&
    !args.remove_attendee?.length
  ) {
    throw new Error("No changes specified.");
  }

  let updatedCount = 0;
  for (const ev of events) {
    if (!ev.href || !ev.ical) continue;

    let updatedIcal = Object.keys(icalPatches).length > 0
      ? updateIcalVevent(ev.ical, icalPatches)
      : ev.ical;

    // Add attendees
    if (args.add_attendee) {
      for (const email of args.add_attendee) {
        const attendeeLine = `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`;
        updatedIcal = updatedIcal.replace("END:VEVENT", `${attendeeLine}\r\nEND:VEVENT`);
      }
    }

    // Remove attendees
    if (args.remove_attendee) {
      for (const email of args.remove_attendee) {
        const lines = updatedIcal.split("\r\n");
        const filtered = lines.filter(
          (l) => !l.toLowerCase().includes(`mailto:${email.toLowerCase()}`),
        );
        updatedIcal = filtered.join("\r\n");
      }
    }

    // Bump SEQUENCE
    const seqMatch = updatedIcal.match(/SEQUENCE:(\d+)/);
    if (seqMatch) {
      const newSeq = parseInt(seqMatch[1], 10) + 1;
      updatedIcal = updatedIcal.replace(seqMatch[0], `SEQUENCE:${newSeq}`);
    }

    await caldav.updateEvent(ev.href, updatedIcal, ev.etag);
    updatedCount++;
  }

  const patchSummary = Object.entries(icalPatches)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("\n");

  const lines = [`✓ Updated ${updatedCount} event(s).`];
  if (patchSummary) lines.push(patchSummary);
  if (args.add_attendee?.length) {
    lines.push(`  Added attendees: ${args.add_attendee.join(", ")}`);
  }
  if (args.remove_attendee?.length) {
    lines.push(`  Removed attendees: ${args.remove_attendee.join(", ")}`);
  }
  return lines.join("\n");
}

export interface QueryEventsArgs {
  after?: string;
  before?: string;
  text?: string;
  attendee?: string;
  uid?: string;
}

export async function cmdQueryEvents(
  cfg: FastmailConfig,
  args: QueryEventsArgs,
): Promise<string> {
  let after: Date | undefined;
  let before: Date | undefined;
  if (args.after) {
    after = new Date(args.after);
    if (isNaN(after.getTime())) throw new Error(`Invalid after: '${args.after}'`);
  }
  if (args.before) {
    before = new Date(args.before);
    if (isNaN(before.getTime())) throw new Error(`Invalid before: '${args.before}'`);
  }

  const caldav = getCaldavClient(cfg);
  if (!caldav) {
    throw new Error("No live CalDAV backend available (caldav vars not set).");
  }

  const calPath = await getCaldavCalendarPath(cfg, caldav);
  let rawEvents: IcalEvent[];

  if (args.uid) {
    const ev = await caldav.getEventByUid(calPath, args.uid);
    rawEvents = ev ? [ev] : [];
  } else {
    rawEvents = await caldav.getCalendarEvents(calPath, after, before);
  }

  // Client-side filters
  let events = rawEvents;
  if (args.text) {
    const needle = args.text.toLowerCase();
    events = events.filter(
      (e) =>
        e.summary.toLowerCase().includes(needle) ||
        e.description.toLowerCase().includes(needle),
    );
  }
  if (args.attendee) {
    const att = args.attendee.toLowerCase();
    events = events.filter((e) =>
      e.attendees.some((a) => a.email.toLowerCase() === att),
    );
  }

  if (events.length === 0) {
    return "No events found matching the specified filters.";
  }

  const blocks = events.map((ev) =>
    formatEventBlock({
      title: ev.summary || "(no title)",
      dtstart: ev.dtstart,
      dtend: ev.dtend,
      duration: ev.duration,
      location: ev.location,
      uid: ev.uid,
      attendees: ev.attendees,
      backend: "caldav",
    }),
  );

  return blocks.join("\n\n");
}
