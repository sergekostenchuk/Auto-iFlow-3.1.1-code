"""
IFlowWrapper
============

A safe wrapper around `iflow-sdk` that handles:
1.  Git Lock Contention (via Monkey-Patching)
2.  Connection Management (WebSocket lifecycle)
3.  Agent Lifecycle (Start/Stop/Cleanup)

This wrapper strictly adheres to the "Consilium" architecture.
"""

import asyncio
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

from iflow_sdk import IFlowClient, IFlowOptions, AssistantMessage

logger = logging.getLogger(__name__)

# --- MONKEY PATCH: Disable Checkpointing to prevent Git Lock ---
from iflow_sdk._internal import process_manager

# Verified patch from spikes/parallel_stress_test.py
async def patched_start(self) -> str:
    """Start the iFlow process with checkpointing disabled.

    Compatible with newer iflow-sdk versions that no longer expose log/drain fields.
    """
    if self._process and self._process.returncode is None:
        return self.url

    # Find iFlow executable (using private method from original class)
    self._iflow_path = self._find_iflow()

    # Find an available port
    self._port = self._find_available_port(self._start_port)

    # Build command - MODIFIED to disable checkpointing
    # We explicitly reconstruct the command list here to inject the flag
    cmd = [self._iflow_path, "--experimental-acp", "--port", str(self._port), "--no-checkpointing"]

    logger.debug(f"[MonkeyPatch] Starting iFlow process: {' '.join(cmd)}")

    try:
        # Start the process
        # Ensure Node.js is discoverable when iFlow CLI is a Node script.
        env = os.environ.copy()
        path_parts = [
            env.get("PATH", ""),
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            "/usr/bin",
            "/bin",
            "/sbin",
        ]
        # Preserve order while removing empty/duplicate entries
        seen = set()
        normalized = []
        for part in ":".join(path_parts).split(":"):
            if not part or part in seen:
                continue
            seen.add(part)
            normalized.append(part)
        env["PATH"] = ":".join(normalized)

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.DEVNULL,
            env=env,
        )

        # Optional log handling for older SDKs
        if hasattr(self, "_log_file") and getattr(self, "_log_file", None):
            try:
                self._log_file_handle = open(self._log_file, "a", encoding="utf-8")
            except Exception as e:
                logger.error(f"Failed to open log file {self._log_file}: {e}")
                self._log_file_handle = None

        # Optional output draining for older SDKs
        if hasattr(self, "_drain_output"):
            self._stdout_task = asyncio.create_task(self._drain_output("stdout"))
            self._stderr_task = asyncio.create_task(self._drain_output("stderr"))

        # Wait a bit to ensure the process starts successfully
        await asyncio.sleep(0.5)

        # Check if process is still running
        if self._process.returncode is not None:
            if self._process.stderr:
                stderr = await self._process.stderr.read()
                error_msg = stderr.decode("utf-8", errors="ignore")
                raise RuntimeError(f"iFlow process exited immediately: {error_msg}")
            raise RuntimeError("iFlow process exited immediately")

        return self.url

    except Exception as e:
        self._process = None
        self._port = None
        raise RuntimeError(f"Failed to start iFlow process: {e}") from e

# Apply the patch globally
process_manager.IFlowProcessManager.start = patched_start
logger.info("[IFlowWrapper] Applied 'no-checkpointing' monkey-patch to IFlowProcessManager")


class IFlowWrapper:
    """
    Wrapper for IFlowClient to safe-guard against concurrency issues.
    """

    def __init__(
        self,
        workspace_dir: str,
        agent_id: str,
        port_offset: int = 0,
        log_dir: Optional[str] = None,
        debug: bool = False,
    ):
        """
        Args:
            workspace_dir: The directory where the agent works.
            agent_id: Unique identifier for this agent instance.
            port_offset: Offset to add to base port (8090) to avoid conflicts.
            agents: List of sub-agents to spawn (Parallel Orchestrator pattern).
            log_dir: Directory to store process logs.
            debug: Enable debug logging.
        """
        self.workspace_dir = Path(workspace_dir).resolve()
        self.agent_id = agent_id
        self.port = 8090 + port_offset
        self.log_dir = Path(log_dir) if log_dir else self.workspace_dir / "logs"
        self.debug = debug
        self.client: Optional[IFlowClient] = None
        self.debug = debug
        self.client: Optional[IFlowClient] = None
        
        # Ensure log dir exists
        self.log_dir.mkdir(parents=True, exist_ok=True)
        # Ensure workspace exists
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

    async def start(self):
        """Starts the IFlow agent process and connects the client."""
        logger.info(f"[{self.agent_id}] Starting IFlow agent on port {self.port}...")
        
        options = IFlowOptions(
            cwd=str(self.workspace_dir),
            process_start_port=self.port,
            process_log_file=str(self.log_dir / f"{self.agent_id}.log"),
        )

        self.client = IFlowClient(options=options)
        await self.client.connect()
        logger.info(f"[{self.agent_id}] Connected!")

    async def stop(self):
        if self.client:
            logger.info(f"[{self.agent_id}] Stopping agent...")
            await self.client.disconnect()
            self.client = None

    async def send_message(self, message: str):
        """Sends a message to the agent."""
        if not self.client:
            raise RuntimeError("Client not connected")
        await self.client.send_message(message)

    async def receive_messages(self) -> AsyncGenerator[AssistantMessage, None]:
        """Yields messages from the agent."""
        if not self.client:
            raise RuntimeError("Client not connected")
        
        async for msg in self.client.receive_messages():
            yield msg

    async def execute_prompt(self, prompt: str, on_message=None) -> str:
        """
        Convenience method to send a prompt and get the full text response.
        Aggregates chunks until the turn is done.
        
        Args:
            prompt: The text prompt to send.
            on_message: Optional async callback(msg) for every message received.
        """
        await self.send_message(prompt)
        
        response_text = ""
        async for msg in self.receive_messages():
            if on_message:
                await on_message(msg)

            # Handle text aggregation
            if hasattr(msg, 'chunk') and msg.chunk:
                 # Check if chunk is text (depends on SDK structure)
                 # Assuming msg.chunk is string or object with text
                 chunk_content = msg.chunk.text if hasattr(msg.chunk, 'text') else str(msg.chunk)
                 response_text += chunk_content
            
            # Check for turn completion
            if getattr(msg, 'type', '') == 'finish' or hasattr(msg, 'stop_reason'):
                 break
            
        return response_text
