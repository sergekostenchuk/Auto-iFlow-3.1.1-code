"""
Auto-iFlow project initialization utilities.

Handles first-time setup of the project data directory and ensures proper
gitignore configuration.
"""

from pathlib import Path

# Default data directory name
DEFAULT_AUTO_BUILD_DIR = ".auto-iflow"
AUTO_BUILD_BRANCH_NAMESPACE = "auto-iflow"

# All entries that should be added to .gitignore for data directories
AUTO_BUILD_GITIGNORE_ENTRIES = [
    ".auto-iflow/",
    ".auto-iflow-security.json",
    ".auto-iflow-allowlist",
    ".auto-iflow-status",
    ".claude_settings.json",
    ".worktrees/",
    ".security-key",
    "logs/security/",
]


def _entry_exists_in_gitignore(lines: list[str], entry: str) -> bool:
    """Check if an entry already exists in gitignore (handles trailing slash variations)."""
    entry_normalized = entry.rstrip("/")
    for line in lines:
        line_stripped = line.strip()
        # Match both "entry" and "entry/"
        if (
            line_stripped == entry
            or line_stripped == entry_normalized
            or line_stripped == entry_normalized + "/"
        ):
            return True
    return False


def ensure_gitignore_entry(project_dir: Path, entry: str = DEFAULT_AUTO_BUILD_DIR + "/") -> bool:
    """
    Ensure an entry exists in the project's .gitignore file.

    Creates .gitignore if it doesn't exist.

    Args:
        project_dir: The project root directory
        entry: The gitignore entry to add (default: ".auto-iflow/")

    Returns:
        True if entry was added, False if it already existed
    """
    gitignore_path = project_dir / ".gitignore"

    # Check if .gitignore exists and if entry is already present
    if gitignore_path.exists():
        content = gitignore_path.read_text()
        lines = content.splitlines()

        if _entry_exists_in_gitignore(lines, entry):
            return False  # Already exists

        # Entry doesn't exist, append it
        # Ensure file ends with newline before adding our entry
        if content and not content.endswith("\n"):
            content += "\n"

        # Add a comment and the entry
        content += "\n# Auto-iFlow data directory\n"
        content += entry + "\n"

        gitignore_path.write_text(content)
        return True
    else:
        # Create new .gitignore with the entry
        content = "# Auto-iFlow data directory\n"
        content += entry + "\n"

        gitignore_path.write_text(content)
        return True


def ensure_all_gitignore_entries(project_dir: Path) -> list[str]:
    """
    Ensure all auto-iflow related entries exist in the project's .gitignore file.

    Creates .gitignore if it doesn't exist.

    Args:
        project_dir: The project root directory

    Returns:
        List of entries that were added (empty if all already existed)
    """
    gitignore_path = project_dir / ".gitignore"
    added_entries: list[str] = []

    # Read existing content or start fresh
    if gitignore_path.exists():
        content = gitignore_path.read_text()
        lines = content.splitlines()
    else:
        content = ""
        lines = []

    # Find entries that need to be added
    entries_to_add = [
        entry
        for entry in AUTO_BUILD_GITIGNORE_ENTRIES
        if not _entry_exists_in_gitignore(lines, entry)
    ]

    if not entries_to_add:
        return []

    # Build the new content to append
    # Ensure file ends with newline before adding our entries
    if content and not content.endswith("\n"):
        content += "\n"

    content += "\n# Auto-iFlow generated files\n"
    for entry in entries_to_add:
        content += entry + "\n"
        added_entries.append(entry)

    gitignore_path.write_text(content)
    return added_entries


def resolve_auto_build_dir(project_dir: Path) -> Path:
    """
    Resolve the active data directory for a project.

    Returns the default .auto-iflow path.
    """
    project_dir = Path(project_dir)
    default_dir = project_dir / DEFAULT_AUTO_BUILD_DIR
    return default_dir


def resolve_auto_build_dir_for_write(project_dir: Path) -> Path:
    """
    Resolve the writable data directory for a project.
    """
    project_dir = Path(project_dir)
    return project_dir / DEFAULT_AUTO_BUILD_DIR


def init_auto_build_dir(project_dir: Path) -> tuple[Path, bool]:
    """
    Initialize the project data directory.

    Creates the directory if needed and ensures all data files are in .gitignore.

    Args:
        project_dir: The project root directory

    Returns:
        Tuple of (data_dir path, gitignore_was_updated)
    """
    project_dir = Path(project_dir)
    auto_build_dir = resolve_auto_build_dir_for_write(project_dir)

    # Create the directory if it doesn't exist
    dir_created = not auto_build_dir.exists()
    auto_build_dir.mkdir(parents=True, exist_ok=True)

    # Ensure all data directory entries are in .gitignore (only on first creation)
    gitignore_updated = False
    if dir_created:
        added = ensure_all_gitignore_entries(project_dir)
        gitignore_updated = len(added) > 0
    else:
        # Even if dir exists, check gitignore on first run
        # Use a marker file to track if we've already checked
        marker = auto_build_dir / ".gitignore_checked"
        if not marker.exists():
            added = ensure_all_gitignore_entries(project_dir)
            gitignore_updated = len(added) > 0
            marker.touch()

    return auto_build_dir, gitignore_updated


def get_auto_build_dir(project_dir: Path, ensure_exists: bool = True) -> Path:
    """
    Get the data directory path, optionally ensuring it exists.

    Args:
        project_dir: The project root directory
        ensure_exists: If True, create directory and update gitignore if needed

    Returns:
        Path to the data directory
    """
    if ensure_exists:
        auto_build_dir, _ = init_auto_build_dir(project_dir)
        return auto_build_dir

    return resolve_auto_build_dir(project_dir)


def repair_gitignore(project_dir: Path) -> list[str]:
    """
    Repair an existing project's .gitignore to include all data directory entries.

    This is useful for projects created before all entries were being added,
    or when gitignore entries were manually removed.

    Also resets the .gitignore_checked marker to allow future updates.

    Args:
        project_dir: The project root directory

    Returns:
        List of entries that were added (empty if all already existed)
    """
    project_dir = Path(project_dir)
    auto_build_dir = resolve_auto_build_dir(project_dir)

    # Remove the marker file so future checks will also run
    marker = auto_build_dir / ".gitignore_checked"
    if marker.exists():
        marker.unlink()

    # Add all missing entries
    added = ensure_all_gitignore_entries(project_dir)

    # Re-create the marker
    if auto_build_dir.exists():
        marker.touch()

    return added
