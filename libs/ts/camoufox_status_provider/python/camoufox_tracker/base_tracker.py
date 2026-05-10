"""
Base class for Camoufox-based carrier tracking scrapers.

Subclasses implement get_url() and extract_status() for each carrier.
The base handles browser lifecycle, timeouts, and error classification.
"""

import asyncio
import sys
from abc import ABC, abstractmethod
from typing import Any

from camoufox.async_api import AsyncCamoufox


# How long to wait for page navigation + content before giving up.
DEFAULT_TIMEOUT_S = 25


class TrackerError(Exception):
    """Structured error with a machine-readable code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class BaseTracker(ABC):
    """Abstract base for scraping a carrier tracking page with Camoufox."""

    carrier: str = "Unknown"

    @abstractmethod
    def get_url(self, tracking_number: str) -> str:
        """Return the tracking page URL for the given number."""

    @abstractmethod
    async def extract_status(self, page: Any) -> dict:
        """
        Extract tracking data from a loaded page.

        Must return a dict with at least:
          tracking_number, carrier, status, delivered,
          last_update (ISO 8601 or None), description (or None)
        May include extra fields like events, expected_delivery, service_type.
        """

    async def wait_for_content(self, page: Any) -> None:
        """
        Wait for carrier-specific content to appear on the page.
        Subclasses should override to wait for the right selector.
        Default: wait for networkidle.
        """
        await page.wait_for_load_state("networkidle")

    async def detect_challenge(self, page: Any) -> bool:
        """Return True if a bot-challenge / interstitial page is detected."""
        title = (await page.title()).lower()
        challenge_markers = [
            "access denied",
            "please verify",
            "are you a robot",
            "captcha",
            "blocked",
            "just a moment",
        ]
        return any(m in title for m in challenge_markers)

    async def track(self, tracking_number: str) -> dict:
        """
        Launch Camoufox, navigate to the tracking page, extract status.
        Returns a structured dict on success, raises TrackerError on failure.
        """
        url = self.get_url(tracking_number)

        try:
            async with AsyncCamoufox(headless=True) as browser:
                context = await browser.new_context()
                page = await context.new_page()

                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                except Exception as exc:
                    raise TrackerError("NAVIGATION_TIMEOUT", f"Failed to load {url}: {exc}")

                try:
                    await asyncio.wait_for(
                        self.wait_for_content(page),
                        timeout=DEFAULT_TIMEOUT_S,
                    )
                except asyncio.TimeoutError:
                    # Page loaded but content didn't appear — may be challenge or slow render.
                    pass

                # SPA settle time — content may still be hydrating after selectors match.
                await asyncio.sleep(2)

                if await self.detect_challenge(page):
                    raise TrackerError("BOT_CHALLENGE", f"Bot challenge detected on {self.carrier}")

                result = await self.extract_status(page)
                result.setdefault("tracking_number", tracking_number.upper())
                result.setdefault("carrier", self.carrier)
                return result

        except TrackerError:
            raise
        except Exception as exc:
            raise TrackerError("BROWSER_ERROR", f"Camoufox error: {exc}")
