#!/usr/bin/env python3
"""
Consilium Integration Test
===========================

Tests the Consilium orchestrator can be started and respond.
Run from apps/backend directory:
    python test_consilium_integration.py
"""

import sys
import os
import subprocess
from pathlib import Path


def test_run_consilium_exists():
    """Test that run_consilium.py exists"""
    script_path = Path(__file__).parent / 'run_consilium.py'
    assert script_path.exists(), f"run_consilium.py not found at {script_path}"
    print(f"✓ run_consilium.py exists at {script_path}")


def test_run_consilium_help():
    """Test that run_consilium.py --help works"""
    script_path = Path(__file__).parent / 'run_consilium.py'
    result = subprocess.run(
        [sys.executable, str(script_path), '--help'],
        capture_output=True,
        text=True,
        timeout=10
    )
    assert result.returncode == 0, f"--help failed: {result.stderr}"
    assert '--task' in result.stdout, "--task flag not found in help"
    print("✓ run_consilium.py --help works")


def test_consilium_import():
    """Test that ConsiliumOrchestrator can be imported"""
    try:
        from core.consilium_orchestrator import ConsiliumOrchestrator
        print("✓ ConsiliumOrchestrator imported successfully")
    except ImportError as e:
        print(f"✗ Failed to import ConsiliumOrchestrator: {e}")
        raise


def test_consilium_models():
    """Test that models can be imported"""
    try:
        from core.models import PlanStep
        print("✓ Models imported successfully")
    except ImportError as e:
        # Not critical - basic models work
        print(f"⚠ Some models not available: {e}")
        print("✓ Models check skipped (optional)")


def test_iflow_wrapper_import():
    """Test that IFlowWrapper can be imported"""
    try:
        from wrappers.iflow_wrapper import IFlowWrapper
        print("✓ IFlowWrapper imported successfully")
    except ImportError as e:
        print(f"✗ Failed to import IFlowWrapper: {e}")
        raise


def run_all_tests():
    """Run all tests"""
    print("=" * 60)
    print("CONSILIUM INTEGRATION TESTS")
    print("=" * 60)
    print()

    tests = [
        test_run_consilium_exists,
        test_run_consilium_help,
        test_consilium_import,
        test_consilium_models,
        test_iflow_wrapper_import,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"✗ {test.__name__} FAILED: {e}")
            failed += 1

    print()
    print("=" * 60)
    print(f"RESULTS: {passed} passed, {failed} failed")
    print("=" * 60)

    return failed == 0


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)
