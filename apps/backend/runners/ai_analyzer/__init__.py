"""
AI-Enhanced Project Analyzer Package

A modular system for running AI-powered analysis on codebases using iFlow.
"""

from .models import AnalysisResult, AnalyzerType
from .runner import AIAnalyzerRunner

__all__ = ["AIAnalyzerRunner", "AnalyzerType", "AnalysisResult"]
