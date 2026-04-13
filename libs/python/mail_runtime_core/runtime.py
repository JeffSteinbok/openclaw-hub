#!/usr/bin/env python3
"""Shared mail pipeline runtime: envelopes, rules, actions, and dispatch."""

from __future__ import annotations

import re
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol


@dataclass
class AttachmentMeta:
    """Metadata about a message attachment."""

    name: str
    content_type: str
    is_inline: bool = False
    content_id: str | None = None


@dataclass
class MailEnvelope:
    """Normalized message shape used by sources, rules, and actions."""

    message_id: str
    provider: str
    account_id: str
    mailbox_id: str | None
    sender_name: str
    sender_email: str
    subject: str
    received_at: str | None = None
    body_text: str | None = None
    body_html: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    has_attachments: bool = False
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionResult:
    """Structured side effect emitted by an action."""

    kind: str
    payload: dict[str, Any]


class MailProviderClient(Protocol):
    """Minimal provider surface actions can rely on."""

    def fetch_body(self, envelope: MailEnvelope) -> MailEnvelope: ...

    def list_attachments(self, envelope: MailEnvelope) -> list[AttachmentMeta]: ...

    def download_attachments(
        self,
        envelope: MailEnvelope,
        output_dir: str,
        *,
        content_types: list[str] | None = None,
        inline_only: bool | None = None,
        include_body_html: bool = False,
    ) -> list[str]: ...


@dataclass
class ActionContext:
    """Runtime context passed to action handlers."""

    envelope: MailEnvelope
    provider_client: MailProviderClient
    workspace: Path
    logger: Callable[[str], None]
    config: dict[str, Any] = field(default_factory=dict)
    artifacts: dict[str, Any] = field(default_factory=dict)


@dataclass
class RegisteredAction:
    """Action handler plus declared data requirements."""

    name: str
    handler: Callable[[ActionContext, dict[str, Any]], list[ActionResult]]
    needs_body: bool = False
    attachment_request: dict[str, Any] | None = None


def normalize_action(action: str | dict[str, Any]) -> tuple[str, dict[str, Any]]:
    if isinstance(action, str):
        return action, {}
    return action["name"], action.get("params", {})


class ActionRegistry:
    """Registry and executor for named mail actions."""

    def __init__(self):
        self._actions: dict[str, RegisteredAction] = {}

    def register(
        self,
        name: str,
        handler: Callable[[ActionContext, dict[str, Any]], list[ActionResult]],
        *,
        needs_body: bool = False,
        attachment_request: dict[str, Any] | None = None,
    ) -> None:
        self._actions[name] = RegisteredAction(
            name=name,
            handler=handler,
            needs_body=needs_body,
            attachment_request=attachment_request,
        )

    def get(self, name: str) -> RegisteredAction:
        if name not in self._actions:
            raise KeyError(f"Unknown mail action: {name}")
        return self._actions[name]


def _to_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    return [value]


def _matches_any_exact(actual: str, expected: Any) -> bool:
    actual_low = (actual or "").lower()
    return any(actual_low == str(item).lower() for item in _to_list(expected))


def _matches_any_contains(actual: str, expected: Any) -> bool:
    actual_low = (actual or "").lower()
    return any(str(item).lower() in actual_low for item in _to_list(expected))


def _matches_any_prefix(actual: str, expected: Any) -> bool:
    actual_low = (actual or "").lower()
    return any(actual_low.startswith(str(item).lower()) for item in _to_list(expected))


def _sender_domain(sender_email: str) -> str:
    if "@" not in (sender_email or ""):
        return ""
    return sender_email.split("@", 1)[1].lower()


def _matches_any_domain(actual: str, expected: Any) -> bool:
    actual_low = (actual or "").lower()
    for item in _to_list(expected):
        wanted = str(item).lower()
        if actual_low == wanted or actual_low.endswith("." + wanted):
            return True
    return False


def _body_text(envelope: MailEnvelope) -> str:
    return " ".join(filter(None, [envelope.body_text, envelope.body_html]))


def rule_matches(envelope: MailEnvelope, rule: dict[str, Any]) -> bool:
    """Return True when an envelope matches a deterministic rule."""

    if rule.get("providers") and not _matches_any_exact(envelope.provider, rule["providers"]):
        return False
    if rule.get("accounts") and not _matches_any_exact(envelope.account_id, rule["accounts"]):
        return False
    if rule.get("mailboxes") and not _matches_any_exact(envelope.mailbox_id or "", rule["mailboxes"]):
        return False

    match = rule.get("match", {})
    if not match:
        return True

    body = None
    for key, expected in match.items():
        if key == "sender_email":
            if not _matches_any_exact(envelope.sender_email, expected):
                return False
        elif key == "sender_domain":
            if not _matches_any_domain(_sender_domain(envelope.sender_email), expected):
                return False
        elif key == "sender_name_contains":
            if not _matches_any_contains(envelope.sender_name, expected):
                return False
        elif key == "subject":
            if not _matches_any_exact(envelope.subject, expected):
                return False
        elif key == "subject_contains":
            if not _matches_any_contains(envelope.subject, expected):
                return False
        elif key == "subject_prefix":
            if not _matches_any_prefix(envelope.subject, expected):
                return False
        elif key == "subject_regex":
            patterns = _to_list(expected)
            if not any(re.search(pattern, envelope.subject or "", re.IGNORECASE) for pattern in patterns):
                return False
        elif key == "body_contains":
            body = body if body is not None else _body_text(envelope)
            if not _matches_any_contains(body, expected):
                return False
        elif key == "has_attachments":
            if bool(expected) != bool(envelope.has_attachments):
                return False
        else:
            raise ValueError(f"Unsupported mail rule condition: {key}")

    return True


def select_matching_rules(envelope: MailEnvelope, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return matching rules in execution order."""

    matches = []
    for rule in rules:
        if not rule.get("enabled", True):
            continue
        if rule_matches(envelope, rule):
            matches.append(rule)
            if not rule.get("continue", False):
                break
    return matches


def execute_rules(
    envelope: MailEnvelope,
    rules: list[dict[str, Any]],
    registry: ActionRegistry,
    provider_client: MailProviderClient,
    *,
    workspace: Path,
    logger: Callable[[str], None],
    config: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[ActionResult]]:
    """Execute matching rule actions and collect structured results."""

    workspace.mkdir(parents=True, exist_ok=True)
    matched = select_matching_rules(envelope, rules)
    results: list[ActionResult] = []

    if matched:
        logger(
            "matched mail rule(s): "
            + ", ".join(rule.get("id", "<unnamed>") for rule in matched)
            + f" | sender={envelope.sender_email} | subject={envelope.subject}"
        )

    for rule in matched:
        for action_cfg in rule.get("actions", []):
            action_name, params = normalize_action(action_cfg)
            action = registry.get(action_name)
            logger(
                f"running mail action {action_name} for rule {rule.get('id', '<unnamed>')}"
            )
            ctx = ActionContext(
                envelope=envelope,
                provider_client=provider_client,
                workspace=workspace,
                logger=logger,
                config=config or {},
            )

            temp_dir: str | None = None
            if action.needs_body:
                ctx.envelope = provider_client.fetch_body(ctx.envelope)

            if action.attachment_request:
                temp_dir = tempfile.mkdtemp(prefix=f"mail-{action_name}-", dir=str(workspace))
                request = dict(action.attachment_request)
                downloaded = provider_client.download_attachments(
                    ctx.envelope,
                    temp_dir,
                    content_types=request.get("content_types"),
                    inline_only=request.get("inline_only"),
                    include_body_html=request.get("include_body_html", False),
                )
                ctx.artifacts["download_dir"] = temp_dir
                ctx.artifacts["downloaded_files"] = downloaded
                logger(
                    f"downloaded {len(downloaded)} artifact(s) for action {action_name}"
                )

            try:
                action_results = action.handler(ctx, params) or []
                results.extend(action_results)
            finally:
                if temp_dir and not params.get("keep_downloads"):
                    shutil.rmtree(temp_dir, ignore_errors=True)

    return matched, results
