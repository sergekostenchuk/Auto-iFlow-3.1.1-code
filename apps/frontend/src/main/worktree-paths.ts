/**
 * Shared worktree path utilities
 *
 * Centralizes all worktree path constants and helper functions to avoid duplication
 * and ensure consistent path handling across the application.
 */

import path from 'path';
import { existsSync } from 'fs';
import { DEFAULT_AUTO_BUILD_PATH } from '../shared/constants';

// Path constants for worktree directories
export const TASK_WORKTREE_DIR = `${DEFAULT_AUTO_BUILD_PATH}/worktrees/tasks`;
export const TERMINAL_WORKTREE_DIR = `${DEFAULT_AUTO_BUILD_PATH}/worktrees/terminal`;

/**
 * Get the task worktrees directory path
 */
export function getTaskWorktreeDir(projectPath: string): string {
  return path.join(projectPath, TASK_WORKTREE_DIR);
}

/**
 * Get the full path for a specific task worktree
 */
export function getTaskWorktreePath(projectPath: string, specId: string): string {
  return path.join(projectPath, TASK_WORKTREE_DIR, specId);
}

/**
 * Find a task worktree path.
 * Returns the path if found, null otherwise
 */
export function findTaskWorktree(projectPath: string, specId: string): string | null {
  const newPath = path.join(projectPath, TASK_WORKTREE_DIR, specId);
  if (existsSync(newPath)) return newPath;

  return null;
}

/**
 * Get the terminal worktrees directory path
 */
export function getTerminalWorktreeDir(projectPath: string): string {
  return path.join(projectPath, TERMINAL_WORKTREE_DIR);
}

/**
 * Get the full path for a specific terminal worktree
 */
export function getTerminalWorktreePath(projectPath: string, name: string): string {
  return path.join(projectPath, TERMINAL_WORKTREE_DIR, name);
}

/**
 * Find a terminal worktree path.
 * Returns the path if found, null otherwise
 */
export function findTerminalWorktree(projectPath: string, name: string): string | null {
  const newPath = path.join(projectPath, TERMINAL_WORKTREE_DIR, name);
  if (existsSync(newPath)) return newPath;

  return null;
}
