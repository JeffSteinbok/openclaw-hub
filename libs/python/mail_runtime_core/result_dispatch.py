#!/usr/bin/env python3
"""Shared ActionResult dispatch helpers."""

from __future__ import annotations

from typing import Callable

from .runtime import ActionResult


def dispatch_results(
    results: list[ActionResult],
    *,
    logger: Callable[[str], None],
    handlers: dict[str, Callable[[dict], None]] | None = None,
) -> None:
    """Deliver structured action results with service-provided side-effect handlers."""

    handlers = handlers or {}
    for result in results:
        if result.kind == "log":
            logger(result.payload["message"])
            continue

        handler = handlers.get(result.kind)
        if handler is None:
            logger(f"warn: unknown action result kind {result.kind}")
            continue

        handler(result.payload)
