"""
Core Models
===========

Pydantic models for internal data structures.
"""

from typing import List, Optional, Literal
from pydantic import BaseModel, Field

class PlanStep(BaseModel):
    """A single step in the plan."""
    id: int
    description: str = Field(..., description="Description of the step")
    assigned_to: Literal["Executor", "Reviewer"] = Field("Executor", description="Who should perform this step")
    status: Literal["pending", "in_progress", "completed", "failed"] = "pending"

class Plan(BaseModel):
    """The execution plan."""
    goal: str = Field(..., description="The high-level goal")
    steps: List[PlanStep] = Field(..., description="List of steps to execute")
