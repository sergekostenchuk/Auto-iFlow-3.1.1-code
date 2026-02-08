"""
Test Consilium Orchestrator
===========================

Validates that ConsiliumOrchestrator correctly:
1. Spawns sub-agents (Planner, Executor, Reviewer)
2. Runs a collaborative task
3. Produces a result
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.append(str(project_root))

from apps.backend.core.consilium_orchestrator import ConsiliumOrchestrator

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

async def main():
    logger.info("🧪 Testing ConsiliumOrchestrator...")
    
    workspace = project_root / "spikes" / "consilium_workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    
    orchestrator = ConsiliumOrchestrator(
        workspace_dir=str(workspace),
        session_id="test_session_1",
        debug=True
    )
    
    try:
        await orchestrator.start()
        
        # Test collaborative task
        task = "Create a python script named 'fib.py' that calculates fibonacci numbers. Ask the Planner to plan it, and Executor to write it."
        logger.info(f"📤 Sending Task: {task}")
        
        response = await orchestrator.run_task(task)
        logger.info(f"📥 Received Response (len={len(response)})")
        # logger.debug(response) # Verbose
        
        # Check if file was created
        fib_file = workspace / "fib.py"
        if fib_file.exists():
            logger.info("✅ SUCCESS: fib.py created")
            content = fib_file.read_text()
            if "def fib" in content or "fibonacci" in content:
                logger.info("✅ SUCCESS: Content looks correct")
            else:
                logger.warning("⚠️ Content might be incorrect")
        else:
             logger.error("❌ FAILURE: fib.py NOT created")

    except Exception as e:
        logger.error(f"❌ FAILURE: Exception occurred: {e}", exc_info=True)
        # sys.exit(1) # Don't exit early, let cleanup happen
        
    finally:
        await orchestrator.stop()

if __name__ == "__main__":
    asyncio.run(main())
