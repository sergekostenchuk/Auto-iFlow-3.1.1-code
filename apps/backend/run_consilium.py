#!/usr/bin/env python3
"""
Run Consilium Orchestrator (Interactive Mode)
=============================================
"""

import argparse
import asyncio
import logging
import os
import queue
import re
import sys
import threading
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from core.consilium_orchestrator import ConsiliumOrchestrator


def parse_args():
    parser = argparse.ArgumentParser(description="Consilium Multi-Agent Orchestrator")
    parser.add_argument("--task", type=str, required=True, help="Initial task")
    parser.add_argument("--workspace", type=Path, default=None, help="Workspace directory")
    parser.add_argument("--project-name", type=str, default=None, help="Project/idea name")
    parser.add_argument("--project-dir", type=Path, default=None, help="Project directory override")
    parser.add_argument("--permission-mode", type=str, default="auto", help="Tool permission mode")
    parser.add_argument("--model", type=str, default="claude-3-5-sonnet-20240620", help="Model to use")
    parser.add_argument("--verbose", action="store_true", help="Enable debug output")
    return parser.parse_args()


# Configure logging to file to keep UI clean
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s:%(name)s:%(message)s",
    filename="consilium.log",
    filemode="w"
)
logger = logging.getLogger("run_consilium")


def slugify(text: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", text.strip(), flags=re.UNICODE).lower()
    cleaned = re.sub(r"[\s_-]+", "-", cleaned).strip("-")
    return cleaned[:64] or "idea"


class ThreadedStdinReader:
    """Reads stdin in a separate thread and puts lines into a queue."""
    
    def __init__(self):
        self.queue = queue.Queue()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._read_stdin, daemon=True)
        self.thread.start()
        
    def _read_stdin(self):
        logger.info("Stdin reader thread started")
        while not self.stop_event.is_set():
            try:
                line = sys.stdin.readline()
                if not line:
                    logger.info("Stdin EOF received")
                    self.stop_event.set()
                    break
                self.queue.put(line.strip())
            except Exception as e:
                logger.error(f"Error reading stdin: {e}")
                self.stop_event.set()
                break

    def get_line_nowait(self):
        try:
            return self.queue.get_nowait()
        except queue.Empty:
            return None


async def interactive_session(orchestrator: ConsiliumOrchestrator, initial_task: str, stdin_reader: ThreadedStdinReader):
    """Run interactive session."""
    
    # Run initial task
    try:
        await orchestrator.run_task(initial_task)
    except Exception as e:
        logger.error(f"Initial task error: {e}")
        print(f"\n❌ ОШИБКА: {e}", flush=True)
        return

    print("\n" + "-" * 60, flush=True)
    print("💬 ИНТЕРАКТИВНЫЙ РЕЖИМ АКТИВЕН", flush=True)
    print("Введите сообщение и нажмите Enter.", flush=True)
    print("-" * 60 + "\n", flush=True)
    
    # Interactive loop
    while not stdin_reader.stop_event.is_set():
        # Check for input non-blocking
        user_input = stdin_reader.get_line_nowait()
        
        if user_input:
            logger.info(f"Received input: {user_input}")
            print(f"\n👤 ВЫ: {user_input}\n", flush=True)
            
            try:
                print("\n[CONSILIUM] Обрабатываю...\n", flush=True)
                await orchestrator.continue_dialog(user_input)
            except Exception as e:
                logger.error(f"Continue dialog error: {e}")
                print(f"Error: {e}", flush=True)
        
        await asyncio.sleep(0.1)


async def main():
    args = parse_args()
    
    # Set model env var if provided (assuming iFlow respects this or we pass it)
    if args.model:
        os.environ["IFLOW_MODEL"] = args.model
        os.environ["OPENAI_MODEL_NAME"] = args.model # Common fallback
        logger.info(f"Setting model to: {args.model}")

    auto_root = Path(__file__).resolve().parents[2]
    project_name = args.project_name or args.task
    project_slug = slugify(project_name)
    project_dir = args.project_dir or (auto_root / project_slug)
    project_dir.mkdir(parents=True, exist_ok=True)

    workspace_dir = args.workspace or project_dir
    workspace_dir.mkdir(parents=True, exist_ok=True)
    
    # Session ID
    import uuid
    session_id = str(uuid.uuid4())[:8]
    
    print(f"INFO: Model: {args.model}", flush=True)
    print("\n" + "=" * 60, flush=True)
    print("🚀 СЕССИЯ CONSILIUM ЗАПУЩЕНА", flush=True)
    print(f"Задача: {args.task}", flush=True)
    print(f"Проект: {project_name}", flush=True)
    print(f"Папка: {project_dir}", flush=True)
    print("=" * 60 + "\n", flush=True)
    
    orchestrator = ConsiliumOrchestrator(
        workspace_dir=str(workspace_dir),
        session_id=session_id,
        debug=args.verbose,
        permission_mode=args.permission_mode,
        project_name=project_name,
        project_dir=str(project_dir),
    )
    
    # Start stdin reader early
    reader = ThreadedStdinReader()
    
    try:
        await orchestrator.start()
        await interactive_session(orchestrator, args.task, reader)
    except KeyboardInterrupt:
        pass
    finally:
        await orchestrator.stop()


if __name__ == "__main__":
    asyncio.run(main())
