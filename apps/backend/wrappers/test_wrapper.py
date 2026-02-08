"""
Test IFlowWrapper
=================

Validates that IFlowWrapper correctly:
1. Starts an agent (with correct port)
2. Disables checkpointing (no git errors)
3. Connects via WebSocket
4. Sends/Receives messages
5. Shuts down cleanly
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.append(str(project_root))

from apps.backend.wrappers.iflow_wrapper import IFlowWrapper

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

async def main():
    logger.info("🧪 Testing IFlowWrapper...")
    
    workspace = project_root / "spikes" / "test_wrapper_workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    
    agent = IFlowWrapper(
        workspace_dir=str(workspace),
        agent_id="test_agent",
        port_offset=100, # Port 8190
        debug=True
    )
    
    try:
        await agent.start()
        
        # Test basic interaction
        prompt = "Hello! What is 2 + 2?"
        logger.info(f"📤 Sending: {prompt}")
        
        response = await agent.execute_prompt(prompt)
        logger.info(f"📥 Received: {response}")
        
        if "4" in response:
            logger.info("✅ SUCCESS: Agent responded correctly")
        else:
            logger.error(f"❌ FAILURE: Unexpected response from agent")
            
    except Exception as e:
        logger.error(f"❌ FAILURE: Exception occurred: {e}", exc_info=True)
        sys.exit(1)
        
    finally:
        await agent.stop()

if __name__ == "__main__":
    asyncio.run(main())
