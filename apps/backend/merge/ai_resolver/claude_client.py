"""
Legacy Claude Client
====================

Compatibility wrapper for legacy imports.

This module keeps the old API surface but routes to the iFlow SDK-based
resolver. Prefer create_iflow_resolver going forward.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .resolver import AIResolver

from .iflow_client import create_iflow_resolver

logger = logging.getLogger(__name__)

def create_claude_resolver() -> AIResolver:
    """Deprecated compatibility shim. Use create_iflow_resolver instead."""
    logger.warning("create_claude_resolver is deprecated; using iFlow resolver.")
    return create_iflow_resolver()
