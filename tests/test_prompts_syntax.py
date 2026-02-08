# tests/test_prompts_syntax.py
"""
Validate prompt file syntax and structure.

This is a fast sanity check that runs on every prompt-related change.
It validates:
- All .md files in prompts/ are valid UTF-8
- Files are not empty
- Files contain at least one {placeholder}
- No orphaned/broken Jinja-style placeholders
"""

import os
import re
from pathlib import Path

import pytest

# Path to prompts directory
PROMPTS_DIR = Path(__file__).parent.parent / "apps" / "backend" / "prompts"


def get_all_prompt_files() -> list[Path]:
    """Collect all .md files from prompts directory recursively."""
    if not PROMPTS_DIR.exists():
        return []
    return list(PROMPTS_DIR.rglob("*.md"))


@pytest.fixture
def prompt_files() -> list[Path]:
    """Fixture providing all prompt files."""
    files = get_all_prompt_files()
    if not files:
        pytest.skip("No prompt files found")
    return files


class TestPromptsSyntax:
    """Test suite for prompt file validation."""

    def test_prompts_directory_exists(self):
        """Verify prompts directory exists."""
        assert PROMPTS_DIR.exists(), f"Prompts directory not found: {PROMPTS_DIR}"
        assert PROMPTS_DIR.is_dir(), f"Prompts path is not a directory: {PROMPTS_DIR}"

    def test_prompt_files_exist(self):
        """Verify at least one prompt file exists."""
        files = get_all_prompt_files()
        assert len(files) > 0, "No .md prompt files found"

    @pytest.mark.parametrize("prompt_file", get_all_prompt_files(), ids=lambda p: p.name)
    def test_file_is_valid_utf8(self, prompt_file: Path):
        """Each prompt file must be valid UTF-8."""
        try:
            content = prompt_file.read_text(encoding="utf-8")
            assert content is not None
        except UnicodeDecodeError as e:
            pytest.fail(f"File {prompt_file.name} is not valid UTF-8: {e}")

    @pytest.mark.parametrize("prompt_file", get_all_prompt_files(), ids=lambda p: p.name)
    def test_file_not_empty(self, prompt_file: Path):
        """Each prompt file must not be empty."""
        content = prompt_file.read_text(encoding="utf-8")
        assert len(content.strip()) > 0, f"File {prompt_file.name} is empty"

    @pytest.mark.parametrize("prompt_file", get_all_prompt_files(), ids=lambda p: p.name)
    def test_file_has_placeholder(self, prompt_file: Path):
        """Each prompt file should have at least one {placeholder} (warning only)."""
        content = prompt_file.read_text(encoding="utf-8")
        # Match {word} or {{word}} patterns
        placeholder_pattern = r"\{+\w+\}+"
        placeholders = re.findall(placeholder_pattern, content)
        if len(placeholders) == 0:
            pytest.skip(
                f"File {prompt_file.name} has no placeholders. "
                "This may be intentional for static prompts."
            )

    @pytest.mark.parametrize("prompt_file", get_all_prompt_files(), ids=lambda p: p.name)
    def test_no_broken_placeholders(self, prompt_file: Path):
        """Check for common placeholder syntax errors."""
        content = prompt_file.read_text(encoding="utf-8")
        
        # Check for unbalanced braces (simple heuristic)
        open_braces = content.count("{")
        close_braces = content.count("}")
        
        # Allow some imbalance for code blocks, but flag large discrepancies
        brace_diff = abs(open_braces - close_braces)
        assert brace_diff <= 5, (
            f"File {prompt_file.name} has unbalanced braces: "
            f"{{ = {open_braces}, }} = {close_braces}"
        )

    @pytest.mark.parametrize("prompt_file", get_all_prompt_files(), ids=lambda p: p.name)
    def test_reasonable_file_size(self, prompt_file: Path):
        """Prompt files should not be excessively large."""
        max_size_kb = 100  # 100KB limit
        file_size = prompt_file.stat().st_size
        assert file_size <= max_size_kb * 1024, (
            f"File {prompt_file.name} is too large: "
            f"{file_size / 1024:.1f}KB > {max_size_kb}KB limit"
        )


class TestPromptsStructure:
    """Test overall prompts directory structure."""

    def test_no_nested_too_deep(self):
        """Prompts shouldn't be nested more than 2 levels deep."""
        for prompt_file in get_all_prompt_files():
            relative = prompt_file.relative_to(PROMPTS_DIR)
            depth = len(relative.parts) - 1  # -1 for the file itself
            assert depth <= 2, (
                f"File {prompt_file} is nested too deep: {depth} levels"
            )

    def test_consistent_naming(self):
        """All prompt files should use snake_case naming."""
        for prompt_file in get_all_prompt_files():
            name = prompt_file.stem  # filename without extension
            # Allow snake_case with optional numbers
            pattern = r"^[a-z][a-z0-9_]*$"
            assert re.match(pattern, name), (
                f"File {prompt_file.name} doesn't follow snake_case convention"
            )
