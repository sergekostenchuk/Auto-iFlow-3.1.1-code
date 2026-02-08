"""
iFlow client module facade.

Provides iFlow API client utilities.
Uses lazy imports to avoid circular dependencies.
"""


def __getattr__(name):
    """Lazy import to avoid circular imports with tool definitions."""
    from core import client as _client

    return getattr(_client, name)


def create_client(*args, **kwargs):
    """Create an iFlow client instance."""
    from core.client import create_client as _create_client

    return _create_client(*args, **kwargs)


__all__ = [
    "create_client",
]
