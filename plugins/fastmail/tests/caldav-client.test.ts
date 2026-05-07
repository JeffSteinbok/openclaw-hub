/**
 * Tests for the CalDAV client module.
 */

import { describe, it, expect } from "vitest";
import { parseIcalEvent, updateIcalVevent } from "../src/caldav-client.js";

describe("parseIcalEvent()", () => {
  const sampleIcal = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//Test//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:test-uid-123@example.com",
    "SUMMARY:Team Standup",
    "DTSTART;TZID=America/Los_Angeles:20260315T140000",
    "DTEND;TZID=America/Los_Angeles:20260315T150000",
    "LOCATION:Conference Room A",
    "DESCRIPTION:Daily standup meeting\\nWith the team",
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "ORGANIZER;CN=Alice:mailto:alice@example.com",
    "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Bob:mailto:bob@example.com",
    "ATTENDEE;PARTSTAT=ACCEPTED;RSVP=FALSE;CN=Carol:mailto:carol@example.com",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("extracts basic properties", () => {
    const ev = parseIcalEvent(sampleIcal);
    expect(ev.uid).toBe("test-uid-123@example.com");
    expect(ev.summary).toBe("Team Standup");
    expect(ev.dtstart).toBe("20260315T140000");
    expect(ev.dtend).toBe("20260315T150000");
    expect(ev.location).toBe("Conference Room A");
    expect(ev.status).toBe("confirmed");
    expect(ev.sequence).toBe(0);
    expect(ev.organizer).toBe("alice@example.com");
  });

  it("parses description with escaped newlines", () => {
    const ev = parseIcalEvent(sampleIcal);
    expect(ev.description).toBe("Daily standup meeting\nWith the team");
  });

  it("parses attendees with params", () => {
    const ev = parseIcalEvent(sampleIcal);
    expect(ev.attendees).toHaveLength(2);

    expect(ev.attendees[0].email).toBe("bob@example.com");
    expect(ev.attendees[0].name).toBe("Bob");
    expect(ev.attendees[0].partstat).toBe("NEEDS-ACTION");
    expect(ev.attendees[0].rsvp).toBe(true);

    expect(ev.attendees[1].email).toBe("carol@example.com");
    expect(ev.attendees[1].partstat).toBe("ACCEPTED");
    expect(ev.attendees[1].rsvp).toBe(false);
  });

  it("handles folded lines (RFC 5545 §3.1)", () => {
    const folded = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:fold-test@example.com",
      "SUMMARY:This is a very long summary that has been ",
      " folded across two lines",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const ev = parseIcalEvent(folded);
    // RFC 5545 §3.1: CRLF + leading whitespace is removed, so the trailing
    // space on line 1 is preserved and the leading space on line 2 is consumed.
    expect(ev.summary).toBe("This is a very long summary that has been folded across two lines");
  });

  it("handles empty iCal", () => {
    const ev = parseIcalEvent("");
    expect(ev.uid).toBe("");
    expect(ev.attendees).toEqual([]);
  });

  it("only parses first VEVENT", () => {
    const multi = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:first@example.com",
      "SUMMARY:First",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:second@example.com",
      "SUMMARY:Second",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const ev = parseIcalEvent(multi);
    expect(ev.uid).toBe("first@example.com");
    expect(ev.summary).toBe("First");
  });
});

describe("updateIcalVevent()", () => {
  const baseIcal = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:update-test@example.com",
    "SUMMARY:Original Title",
    "LOCATION:Room A",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("patches SUMMARY", () => {
    const updated = updateIcalVevent(baseIcal, { SUMMARY: "New Title" });
    expect(updated).toContain("SUMMARY:New Title");
    expect(updated).not.toContain("Original Title");
  });

  it("patches LOCATION", () => {
    const updated = updateIcalVevent(baseIcal, { LOCATION: "Room B" });
    expect(updated).toContain("LOCATION:Room B");
    expect(updated).not.toContain("Room A");
  });

  it("removes property with null", () => {
    const updated = updateIcalVevent(baseIcal, { LOCATION: null });
    expect(updated).not.toContain("LOCATION:");
  });

  it("adds new property if not present", () => {
    const updated = updateIcalVevent(baseIcal, { DESCRIPTION: "New desc" });
    expect(updated).toContain("DESCRIPTION:New desc");
  });

  it("patches with params object", () => {
    const updated = updateIcalVevent(baseIcal, {
      DTSTART: { params: ";TZID=America/New_York", value: "20260401T090000" },
    });
    expect(updated).toContain("DTSTART;TZID=America/New_York:20260401T090000");
  });

  it("preserves unmodified properties", () => {
    const updated = updateIcalVevent(baseIcal, { SUMMARY: "Changed" });
    expect(updated).toContain("UID:update-test@example.com");
    expect(updated).toContain("LOCATION:Room A");
    expect(updated).toContain("SEQUENCE:0");
  });

  it("outputs CRLF line endings", () => {
    const updated = updateIcalVevent(baseIcal, { SUMMARY: "Test" });
    expect(updated).toContain("\r\n");
    // Should not have bare \n (except within \r\n)
    const withoutCRLF = updated.replace(/\r\n/g, "");
    expect(withoutCRLF).not.toContain("\n");
  });
});
