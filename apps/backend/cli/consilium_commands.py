"""
Consilium Commands
==================

CLI commands for the Consilium multi-agent orchestrator.
"""

import asyncio
import logging
from pathlib import Path

from core.consilium_orchestrator import ConsiliumOrchestrator


logger = logging.getLogger(__name__)


def handle_consilium_command(
    project_dir: Path,
    task: str,
    verbose: bool = False,
) -> None:
    """
    Handle the --consilium CLI command.
    
    Args:
        project_dir: The project root directory.
        task: The task description to execute.
        verbose: Enable verbose logging.
    """
    if verbose:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO)
    
    # Create workspace directory for Consilium outputs
    workspace_dir = project_dir / ".auto-iflow" / "consilium_workspace"
    workspace_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate a simple session ID
    import uuid
    session_id = str(uuid.uuid4())[:8]
    
    logger.info(f"Starting Consilium session: {session_id}")
    logger.info(f"Workspace: {workspace_dir}")
    logger.info(f"Task: {task}")
    
    # Run the orchestrator
    orchestrator = ConsiliumOrchestrator(
        workspace_dir=str(workspace_dir),
        session_id=session_id,
        debug=verbose,
        permission_mode="auto",
        project_name=project_dir.name,
        project_dir=str(project_dir),
    )
    
    async def run():
        try:
            await orchestrator.start()
            result = await orchestrator.run_task(task)
            logger.info("Task completed.")
            print("\n--- Final Result ---")
            print(result)
        finally:
            await orchestrator.stop()
    
    asyncio.run(run())
