/**
 * Tests for DKIM/SPF/DMARC rule conditions.
 */

import { describe, it, expect } from "vitest";
import { ruleMatches, type MailEnvelope } from "@openclaw/mail-runtime-core";

function makeEnvelope(auth: { dkim?: string; spf?: string; dmarc?: string }): MailEnvelope {
  return {
    message_id: "msg1",
    provider: "fastmail",
    account_id: "acct1",
    mailbox_id: "inbox1",
    sender_name: "Test Sender",
    sender_email: "sender@example.com",
    subject: "Test Subject",
    auth_results: { ...auth },
  };
}

describe("TestAuthRuleConditions", () => {
  it("should match dkim_pass=true when dkim passes", () => {
    const envelope = makeEnvelope({ dkim: "pass" });
    expect(ruleMatches(envelope, { match: { dkim_pass: true } })).toBe(true);
  });

  it("should not match dkim_pass=true when dkim fails", () => {
    const envelope = makeEnvelope({ dkim: "fail" });
    expect(ruleMatches(envelope, { match: { dkim_pass: true } })).toBe(false);
  });

  it("should match dkim_pass=false when dkim fails", () => {
    const envelope = makeEnvelope({ dkim: "fail" });
    expect(ruleMatches(envelope, { match: { dkim_pass: false } })).toBe(true);
  });

  it("should match spf_pass=true when spf passes", () => {
    const envelope = makeEnvelope({ spf: "pass" });
    expect(ruleMatches(envelope, { match: { spf_pass: true } })).toBe(true);
  });

  it("should not match spf_pass=true when spf fails", () => {
    const envelope = makeEnvelope({ spf: "fail" });
    expect(ruleMatches(envelope, { match: { spf_pass: true } })).toBe(false);
  });

  it("should match dmarc_pass=true when dmarc passes", () => {
    const envelope = makeEnvelope({ dmarc: "pass" });
    expect(ruleMatches(envelope, { match: { dmarc_pass: true } })).toBe(true);
  });

  it("should match dmarc_pass=false when dmarc fails", () => {
    const envelope = makeEnvelope({ dmarc: "fail" });
    expect(ruleMatches(envelope, { match: { dmarc_pass: false } })).toBe(true);
  });

  it("should treat missing auth_results as non-pass for dkim_pass=true", () => {
    const envelope = makeEnvelope({});
    expect(ruleMatches(envelope, { match: { dkim_pass: true } })).toBe(false);
  });

  it("should treat missing auth_results as non-pass for spf_pass=true", () => {
    const envelope = makeEnvelope({});
    expect(ruleMatches(envelope, { match: { spf_pass: true } })).toBe(false);
  });

  it("should treat missing auth_results as non-pass for dmarc_pass=true", () => {
    const envelope = makeEnvelope({});
    expect(ruleMatches(envelope, { match: { dmarc_pass: true } })).toBe(false);
  });

  it("should handle envelope with no auth_results field at all", () => {
    const envelope: MailEnvelope = {
      message_id: "msg2",
      provider: "fastmail",
      account_id: "acct1",
      mailbox_id: null,
      sender_name: "No Auth",
      sender_email: "noauth@example.com",
      subject: "No auth",
    };
    expect(ruleMatches(envelope, { match: { dkim_pass: true } })).toBe(false);
    expect(ruleMatches(envelope, { match: { dkim_pass: false } })).toBe(true);
  });
});
