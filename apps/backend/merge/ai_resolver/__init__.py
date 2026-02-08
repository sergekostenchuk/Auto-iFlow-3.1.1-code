"""
AI Resolver Module
==================

AI-based conflict resolution for the Auto iFlow merge system.

This module provides intelligent conflict resolution using AI with
minimal context to reduce token usage and cost.

Components:
- AIResolver: Main resolver class
- ConflictContext: Minimal context for AI prompts
- create_iflow_resolver: Factory for iFlow-based resolver
- create_claude_resolver: Legacy compatibility alias

Usage:
    from merge.ai_resolver import AIResolver, create_iflow_resolver

    # Create resolver with iFlow integration
    resolver = create_iflow_resolver()

    # Or create with custom AI function
    resolver = AIResolver(ai_call_fn=my_ai_function)

    # Resolve a conflict
    result = resolver.resolve_conflict(conflict, baseline_code, task_snapshots)
"""

from .claude_client import create_claude_resolver
from .context import ConflictContext
from .iflow_client import create_iflow_resolver
from .resolver import AIResolver

__all__ = [
    "AIResolver",
    "ConflictContext",
    "create_iflow_resolver",
    "create_claude_resolver",
]
