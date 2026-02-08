"""
Consilium Display
=================

Handles TUI visualization for the Consilium Orchestrator.
Adapts SDK events into user-friendly UI updates (Spinners, Boxes, Status).
"""

import logging
from typing import Optional

from ui.main import (
    Spinner,
    box,
    print_header,
    print_section,
    print_status,
    bold,
    color,
    Color,
    Icons,
    icon,
    select_menu,
    MenuOption
)

logger = logging.getLogger(__name__)

class ConsiliumDisplay:
    """
    Visualizer for Consilium execution.
    """

    def __init__(self):
        self._current_agent: Optional[str] = None
        self._spinner: Optional[Spinner] = None
        self._active_task: Optional[str] = None

    def ask_approval(self, prompt: str) -> bool:
        """Asks user for approval using a menu."""
        self._stop_spinner()
        options = [
            MenuOption("approve", "Approve", icon=Icons.SUCCESS, description="Proceed with the plan"),
            MenuOption("reject", "Reject", icon=Icons.ERROR, description="Refine the plan"),
        ]
        selection = select_menu(prompt, options)
        return selection == "approve"

    def ask_input(self, prompt: str) -> str:
        """Asks user for text input."""
        self._stop_spinner()
        print_status(prompt, "info")
        return input("> ")

    def start_session(self, session_id: str):
        """Called when session starts."""
        print_header(f"Consilium Session: {session_id}")

    def end_session(self):
        """Called when session ends."""
        self._stop_spinner()
        print_section("Session Ended")

    def set_active_agent(self, agent_name: str, status_msg: str = "Working"):
        """Updates the currently active agent and spinner."""
        if self._current_agent != agent_name:
             self._stop_spinner()
             self._current_agent = agent_name
             
             # Different visual style per agent could go here
             prefix = f"[{bold(agent_name)}]"
             msg = f"{prefix} {status_msg}"
             self._start_spinner(msg)
        else:
            # Just update message
            if self._spinner:
                self._spinner.update(f"[{bold(agent_name)}] {status_msg}")

    def update_status(self, message: str):
        """Updates status of current agent."""
        if self._spinner:
            self._spinner.update(f"[{bold(self._current_agent or 'System')}] {message}")
        else:
            print_status(message, "info")

    def show_tool_call(self, agent_name: str, tool_name: str, args: str):
        """Displays a tool call."""
        # We might want to clear spinner line, print tool call, then resume spinner?
        # Or just log it above the spinner.
        # UI module handles clearing line on spinner stop/update usually.
        
        # Stop spinner briefly to print clean log
        self._stop_spinner()
        
        # Print tool usage
        msg = f"{bold(agent_name)} is using {color(tool_name, Color.CYAN)}"
        print_status(msg, "info")
        # Optional: showing args if verbose, maybe truncated
        # print(f"  {args}")
        
        # Resume spinner
        self._start_spinner(f"[{bold(agent_name)}] Executing {tool_name}...")

    def show_tool_result(self, agent_name: str, tool_name: str, result_summary: str):
        """Displays tool result summary."""
        self._stop_spinner()
        print_status(f"{color(tool_name, Color.CYAN)} finished: {result_summary}", "success")
        self._start_spinner(f"[{bold(agent_name)}] Thinking...")

    def show_agent_message(self, agent_name: str, message: str):
        """Displays a text message/thought from an agent."""
        self._stop_spinner()
        
        # Box the message if it's substantial (e.g. Planner output)
        # Otherwise just print.
        
        if len(message) > 50 or "\n" in message:
             print(box(message, title=agent_name, style="light"))
        else:
             print(f"{bold(agent_name)}: {message}")
             
        self._start_spinner(f"[{bold(agent_name)}] Thinking...")

    def show_plan(self, plan_data: dict):
        """
        Displays the structured plan.
        Expected format: {'steps': [{'id': 1, 'desc': '...'}, ...]}
        """
        self._stop_spinner()
        
        lines = []
        steps = plan_data.get("steps", [])
        for step in steps:
            status_icon = icon(Icons.SUBTASK) # Default to TODO
            lines.append(f"{status_icon} {step.get('description', 'Unknown step')}")
            
        print(box(lines, title="Proposed Plan", style="heavy"))
        # Don't restart spinner immediately, usually waits for user interaction here

    def _start_spinner(self, message: str):
        if self._spinner:
            self._spinner.update(message)
        else:
            self._spinner = Spinner(message)
            self._spinner.start()

    def _stop_spinner(self):
        if self._spinner:
            self._spinner.stop()
            self._spinner = None
