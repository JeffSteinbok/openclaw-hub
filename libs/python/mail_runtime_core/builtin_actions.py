#!/usr/bin/env python3
"""Shared built-in mail actions."""

from __future__ import annotations

from typing import Callable

from .package_tracking import (
    TrackingClient,
    is_delivery_notification,
    load_tracking_client,
    scan_and_add_packages,
    scan_and_remove_delivered,
)
from .runtime import ActionContext, ActionRegistry, ActionResult, MailEnvelope


def format_message(sender_str: str, sender_email: str, subject: str) -> str | None:
    """Format an email into a notification string. Returns None to skip."""

    low = (subject or "").lower()

    if any(keyword in low for keyword in ("unsubscribe", "noreply", "no-reply")):
        return None

    for prefix, emoji, verb in [
        ("accepted:", "👍", "accepted"),
        ("declined:", "👎", "declined"),
        ("tentative:", "🤷", "tentative"),
    ]:
        if low.startswith(prefix):
            event = subject[len(prefix) :].strip()
            name = sender_str.split("<")[0].strip() or sender_email
            return f"👤 {name} {verb} {emoji}: {event}"

    name = sender_str.split("<")[0].strip() or sender_email
    return f"📧 {name}: {subject}"


def build_notify_email_action(
    *,
    mailbox_prefix_resolver: Callable[[MailEnvelope], str],
) -> Callable[[ActionContext, dict], list[ActionResult]]:
    """Create the shared notification action."""

    def _notify_email_action(ctx: ActionContext, params: dict) -> list[ActionResult]:
        del params
        sender_str = ctx.envelope.sender_email
        if ctx.envelope.sender_name:
            sender_str = f"{ctx.envelope.sender_name} <{ctx.envelope.sender_email}>"
        message = format_message(sender_str, ctx.envelope.sender_email, ctx.envelope.subject)
        if message is None:
            ctx.logger(f"skipped: {sender_str} — {ctx.envelope.subject}")
            return []
        prefix = mailbox_prefix_resolver(ctx.envelope)
        return [ActionResult(kind="message", payload={"message": f"{prefix}{message}"})]

    return _notify_email_action


def build_detect_tracking_action(
    *,
    account_label_resolver: Callable[[MailEnvelope], str],
    tracking_client_loader: Callable[[], TrackingClient] = load_tracking_client,
) -> Callable[[ActionContext, dict], list[ActionResult]]:
    """Create the shared package-tracking action."""

    def _detect_tracking_action(ctx: ActionContext, params: dict) -> list[ActionResult]:
        del params
        if is_delivery_notification(ctx.envelope.subject):
            removed = scan_and_remove_delivered(
                ctx.envelope,
                logger=ctx.logger,
                tracking_client_loader=tracking_client_loader,
            )
            return [
                ActionResult(
                    kind="message",
                    payload={
                        "message": f"✅ Package delivered & removed from tracking: {tracking_number}"
                    },
                )
                for tracking_number in removed
            ]

        added = scan_and_add_packages(
            ctx.envelope,
            account_label=account_label_resolver(ctx.envelope),
            logger=ctx.logger,
            tracking_client_loader=tracking_client_loader,
        )
        return [
            ActionResult(
                kind="message",
                payload={"message": f"📦 Package registered: {tracking_number}"},
            )
            for tracking_number in added
        ]

    return _detect_tracking_action


def register_builtin_actions(
    registry: ActionRegistry,
    *,
    mailbox_prefix_resolver: Callable[[MailEnvelope], str],
    account_label_resolver: Callable[[MailEnvelope], str],
    tracking_client_loader: Callable[[], TrackingClient] = load_tracking_client,
) -> None:
    """Register the shared built-in mail actions."""

    registry.register(
        "notify_email",
        build_notify_email_action(mailbox_prefix_resolver=mailbox_prefix_resolver),
    )
    registry.register(
        "detect_tracking",
        build_detect_tracking_action(
            account_label_resolver=account_label_resolver,
            tracking_client_loader=tracking_client_loader,
        ),
        needs_body=True,
    )
