"""
iFlow client wrapper for AI analysis.
"""

from pathlib import Path
from typing import Any

try:
    from phase_config import resolve_model_id

    import iflow_sdk  # noqa: F401

    IFLOW_SDK_AVAILABLE = True
except ImportError:
    IFLOW_SDK_AVAILABLE = False

from core.iflow_client import create_iflow_client
from core.iflow_compat import IFlowCompatClient


class IFlowAnalysisClient:
    """Wrapper for iFlow client with analysis-specific configuration."""

    DEFAULT_MODEL = "sonnet"  # Shorthand - resolved via API Profile if configured
    MAX_TURNS = 50

    def __init__(self, project_dir: Path):
        """
        Initialize iFlow client.

        Args:
            project_dir: Root directory of project being analyzed
        """
        if not IFLOW_SDK_AVAILABLE:
            raise RuntimeError(
                "iflow-sdk not available. Install with: pip install iflow-sdk"
            )

        self.project_dir = project_dir
        self._validate_oauth_token()

    def _validate_oauth_token(self) -> None:
        """Validate that an authentication token is available."""
        from core.auth import require_iflow_auth

        require_iflow_auth()  # Raises ValueError if no auth found

    async def run_analysis_query(self, prompt: str) -> str:
        """
        Run an iFlow query for analysis.

        Args:
            prompt: The analysis prompt

        Returns:
            Response text
        """
        client = self._create_client()

        async with client:
            await client.query(prompt)
            return await self._collect_response(client)

    def _create_client(self) -> Any:
        """
        Create configured iFlow client.

        Returns:
            IFlowCompatClient instance
        """
        system_prompt = (
            f"You are a senior software architect analyzing this codebase. "
            f"Your working directory is: {self.project_dir.resolve()}\n"
            f"Use Read, Grep, and Glob tools to analyze actual code. "
            f"Output your analysis as valid JSON only."
        )

        client = create_iflow_client(
            project_dir=self.project_dir,
            model=resolve_model_id(self.DEFAULT_MODEL),
            max_turns=self.MAX_TURNS,
            session_settings={"system_prompt": system_prompt},
            file_access=True,
            file_allowed_dirs=[str(self.project_dir.resolve())],
            file_read_only=True,
        )
        return IFlowCompatClient(client)

    async def _collect_response(self, client: Any) -> str:
        """
        Collect text response from iFlow client.

        Args:
            client: IFlowCompatClient instance

        Returns:
            Collected response text
        """
        response_text = ""

        async for msg in client.receive_response():
            msg_type = type(msg).__name__

            if msg_type == "AssistantMessage":
                for content in msg.content:
                    if hasattr(content, "text"):
                        response_text += content.text

        return response_text
