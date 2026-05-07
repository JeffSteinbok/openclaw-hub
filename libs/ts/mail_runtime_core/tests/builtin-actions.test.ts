import { describe, it, expect, vi } from "vitest";
import {
  formatMessage,
  buildNotifyEmailAction,
  buildDetectTrackingAction,
} from "../src/builtin-actions.js";
import type { ActionContext, MailEnvelope } from "../src/runtime.js";

function envelope(overrides: Partial<MailEnvelope> = {}): MailEnvelope {
  return {
    message_id: "msg-1",
    provider: "test-provider",
    account_id: "acct-1",
    mailbox_id: "inbox",
    sender_name: "Alice Smith",
    sender_email: "alice@example.com",
    subject: "Hello World",
    ...overrides,
  };
}

function actionContext(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    envelope: envelope(),
    provider_client: {} as ActionContext["provider_client"],
    workspace: "/mock",
    logger: vi.fn(),
    config: {},
    artifacts: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatMessage
// ---------------------------------------------------------------------------
describe("formatMessage", () => {
  it("regular email", () => {
    expect(formatMessage("Alice <alice@ex.com>", "alice@ex.com", "Hello")).toBe(
      "📧 Alice: Hello",
    );
  });

  it("no sender name", () => {
    expect(formatMessage("", "alice@ex.com", "Hello")).toBe("📧 alice@ex.com: Hello");
  });

  it("sender email only in str", () => {
    expect(formatMessage("alice@ex.com", "alice@ex.com", "Hello")).toBe(
      "📧 alice@ex.com: Hello",
    );
  });

  it("calendar accepted", () => {
    const result = formatMessage("Bob <bob@ex.com>", "bob@ex.com", "Accepted: Team standup");
    expect(result).toContain("👍");
    expect(result).toContain("accepted");
    expect(result).toContain("Team standup");
  });

  it("calendar declined", () => {
    const result = formatMessage("Bob <bob@ex.com>", "bob@ex.com", "Declined: Team standup");
    expect(result).toContain("👎");
    expect(result).toContain("declined");
  });

  it("calendar tentative", () => {
    const result = formatMessage("Bob <bob@ex.com>", "bob@ex.com", "Tentative: Team standup");
    expect(result).toContain("🤷");
    expect(result).toContain("tentative");
  });

  it("skip unsubscribe", () => {
    expect(formatMessage("a", "a@b.com", "Unsubscribe confirmation")).toBeNull();
  });

  it("skip noreply", () => {
    expect(formatMessage("a", "a@b.com", "noreply notification")).toBeNull();
  });

  it("skip no-reply", () => {
    expect(formatMessage("a", "a@b.com", "no-reply message")).toBeNull();
  });

  it("case insensitive skip", () => {
    expect(formatMessage("a", "a@b.com", "UNSUBSCRIBE NOW")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildNotifyEmailAction
// ---------------------------------------------------------------------------
describe("buildNotifyEmailAction", () => {
  it("emits result", () => {
    const resolver = vi.fn().mockReturnValue("[inbox] ");
    const action = buildNotifyEmailAction({ mailboxPrefixResolver: resolver });

    const env = envelope({ sender_name: "Alice", sender_email: "alice@ex.com", subject: "Hi" });
    const ctx = actionContext({ envelope: env });
    const results = action(ctx, {});

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("message");
    expect(results[0].payload["message"]).toContain("Alice");
    expect(results[0].payload["message"]).toContain("[inbox]");
  });

  it("skips filtered", () => {
    const resolver = vi.fn().mockReturnValue("");
    const action = buildNotifyEmailAction({ mailboxPrefixResolver: resolver });

    const env = envelope({ subject: "Unsubscribe please" });
    const ctx = actionContext({ envelope: env });
    const results = action(ctx, {});

    expect(results).toEqual([]);
    expect(ctx.logger).toHaveBeenCalledOnce();
    expect((ctx.logger as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("skipped");
  });

  it("no sender name uses email", () => {
    const resolver = vi.fn().mockReturnValue("");
    const action = buildNotifyEmailAction({ mailboxPrefixResolver: resolver });

    const env = envelope({ sender_name: "", sender_email: "bob@ex.com", subject: "Hey" });
    const ctx = actionContext({ envelope: env });
    const results = action(ctx, {});

    expect(results).toHaveLength(1);
    expect(results[0].payload["message"]).toContain("bob@ex.com");
  });
});

// ---------------------------------------------------------------------------
// buildDetectTrackingAction
// ---------------------------------------------------------------------------
describe("buildDetectTrackingAction", () => {
  it("delivery triggers remove", async () => {
    const mockClient = {
      isShippingSender: vi.fn().mockReturnValue(true),
      scanTextForTrackingNumbers: vi.fn().mockReturnValue([
        { tracking_number: "1Z999", carrier: "UPS" },
      ]),
      extractTrackingFromUrls: vi.fn().mockReturnValue([]),
      fetchNarvarTracking: vi.fn().mockReturnValue([]),
      addPackage: vi.fn().mockReturnValue({ success: true }),
      removePackage: vi.fn().mockReturnValue({ success: true }),
    };

    const labelResolver = vi.fn().mockReturnValue("TestAcct");
    const action = buildDetectTrackingAction({
      accountLabelResolver: labelResolver,
      trackingClientLoader: () => mockClient,
    });

    const env = envelope({
      subject: "Your package has been delivered",
      body_text: "1Z999",
    });
    const ctx = actionContext({ envelope: env });
    const results = await action(ctx, {});

    expect(results).toHaveLength(1);
    expect((results[0].payload["message"] as string).toLowerCase()).toContain("delivered");
    expect(mockClient.removePackage).toHaveBeenCalledWith("1Z999");
  });

  it("non-delivery triggers add", async () => {
    const mockClient = {
      isShippingSender: vi.fn().mockReturnValue(true),
      scanTextForTrackingNumbers: vi.fn().mockReturnValue([
        { tracking_number: "1Z999", carrier: "UPS" },
      ]),
      extractTrackingFromUrls: vi.fn().mockReturnValue([]),
      fetchNarvarTracking: vi.fn().mockReturnValue([]),
      addPackage: vi.fn().mockReturnValue({ success: true }),
      removePackage: vi.fn().mockReturnValue({ success: true }),
    };

    const labelResolver = vi.fn().mockReturnValue("TestAcct");
    const action = buildDetectTrackingAction({
      accountLabelResolver: labelResolver,
      trackingClientLoader: () => mockClient,
    });

    const env = envelope({
      subject: "Your package is on its way",
      sender_email: "tracking@fedex.com",
      body_text: "Track: 1Z999",
    });
    const ctx = actionContext({ envelope: env });
    const results = await action(ctx, {});

    expect(results).toHaveLength(1);
    expect((results[0].payload["message"] as string).toLowerCase()).toContain("registered");
    expect(mockClient.addPackage).toHaveBeenCalled();
  });

  it("delivery no tracking found", async () => {
    const mockClient = {
      isShippingSender: vi.fn().mockReturnValue(true),
      scanTextForTrackingNumbers: vi.fn().mockReturnValue([]),
      extractTrackingFromUrls: vi.fn().mockReturnValue([]),
      fetchNarvarTracking: vi.fn().mockReturnValue([]),
      addPackage: vi.fn().mockReturnValue({ success: true }),
      removePackage: vi.fn().mockReturnValue({ success: true }),
    };

    const labelResolver = vi.fn().mockReturnValue("TestAcct");
    const action = buildDetectTrackingAction({
      accountLabelResolver: labelResolver,
      trackingClientLoader: () => mockClient,
    });

    const env = envelope({ subject: "Package delivered", body_text: "No tracking here" });
    const ctx = actionContext({ envelope: env });
    const results = await action(ctx, {});

    expect(results).toEqual([]);
  });
});
