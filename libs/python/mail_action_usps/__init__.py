"""Shared USPS mail action module."""

from .analyze import process_digest
from .register import process_usps_digest_action, register_usps_actions

__all__ = ["process_digest", "process_usps_digest_action", "register_usps_actions"]
