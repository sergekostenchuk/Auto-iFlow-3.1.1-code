/**
 * Configuration Paths Module
 *
 * Provides XDG Base Directory Specification compliant paths for storing
 * application configuration and data. This is essential for AppImage,
 * Flatpak, and Snap installations where the application runs in a
 * sandboxed or immutable filesystem environment.
 *
 * XDG Base Directory Specification:
 * - $XDG_CONFIG_HOME: User configuration (default: ~/.config)
 * - $XDG_DATA_HOME: User data (default: ~/.local/share)
 * - $XDG_CACHE_HOME: User cache (default: ~/.cache)
 *
 * @see https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { DEFAULT_GRAPHITI_DATABASE } from '../shared/constants';

const APP_NAME = 'auto-iflow';

function resolveAppDir(baseDir: string): string {
  return path.join(baseDir, APP_NAME);
}

/**
 * Get the XDG config home directory
 * Uses $XDG_CONFIG_HOME if set, otherwise defaults to ~/.config
 */
export function getXdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

/**
 * Get the XDG data home directory
 * Uses $XDG_DATA_HOME if set, otherwise defaults to ~/.local/share
 */
export function getXdgDataHome(): string {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

/**
 * Get the XDG cache home directory
 * Uses $XDG_CACHE_HOME if set, otherwise defaults to ~/.cache
 */
export function getXdgCacheHome(): string {
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
}

/**
 * Get the application config directory
 * Returns the XDG-compliant path for storing configuration files
 */
export function getAppConfigDir(): string {
  return resolveAppDir(getXdgConfigHome());
}

/**
 * Get the application data directory
 * Returns the XDG-compliant path for storing application data
 */
export function getAppDataDir(): string {
  return resolveAppDir(getXdgDataHome());
}

/**
 * Get the application cache directory
 * Returns the XDG-compliant path for storing cache files
 */
export function getAppCacheDir(): string {
  return resolveAppDir(getXdgCacheHome());
}

function expandHomeDir(inputPath: string): string {
  if (!inputPath.startsWith('~')) {
    return inputPath;
  }
  return inputPath.replace(/^~(?=$|[\\/])/, os.homedir());
}

function getPreferredGraphitiBaseDir(): string {
  if (process.platform === 'linux' && (process.env.XDG_DATA_HOME || process.env.APPIMAGE || process.env.SNAP || process.env.FLATPAK_ID)) {
    return path.join(resolveAppDir(getXdgDataHome()), 'graphs');
  }
  return path.join(os.homedir(), '.auto-iflow', 'graphs');
}

function findExistingGraphitiDatabase(basePath: string): string | null {
  if (fs.existsSync(path.join(basePath, DEFAULT_GRAPHITI_DATABASE))) {
    return DEFAULT_GRAPHITI_DATABASE;
  }
  return null;
}

export function resolveGraphitiStorageDefaults(
  dbPathOverride?: string,
  databaseOverride?: string
): { dbPath: string; database: string } {
  const preferredPath = getPreferredGraphitiBaseDir();
  const homePath = path.join(os.homedir(), '.auto-iflow', 'graphs');
  const candidates = [preferredPath];

  if (!isImmutableEnvironment()) {
    if (homePath !== preferredPath) {
      candidates.push(homePath);
    }
  }

  if (dbPathOverride) {
    const resolvedPath = expandHomeDir(dbPathOverride);
    const database = databaseOverride || findExistingGraphitiDatabase(resolvedPath) || DEFAULT_GRAPHITI_DATABASE;
    return { dbPath: resolvedPath, database };
  }

  if (databaseOverride) {
    const matchedPath = candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, databaseOverride))
    );
    return { dbPath: matchedPath || preferredPath, database: databaseOverride };
  }

  for (const candidate of candidates) {
    const existing = findExistingGraphitiDatabase(candidate);
    if (existing) {
      return { dbPath: candidate, database: existing };
    }
  }

  if (!fs.existsSync(preferredPath)) {
    try {
      fs.mkdirSync(preferredPath, { recursive: true });
    } catch {
      // Ignore mkdir failures; callers will handle missing directory.
    }
  }

  return { dbPath: preferredPath, database: DEFAULT_GRAPHITI_DATABASE };
}

/**
 * Get the Graphiti storage directory
 * This is where graph databases are stored
 */
export function getMemoriesDir(): string {
  const defaultPath = getPreferredGraphitiBaseDir();

  // On Linux with XDG variables set (AppImage, Flatpak, Snap), use XDG path
  if (process.platform === 'linux' && (process.env.XDG_DATA_HOME || process.env.APPIMAGE || process.env.SNAP || process.env.FLATPAK_ID)) {
    if (!fs.existsSync(defaultPath)) {
      try {
        fs.mkdirSync(defaultPath, { recursive: true });
      } catch {
        // Ignore mkdir failures; callers will handle missing directory.
      }
    }
    return defaultPath;
  }

  const defaultExists = fs.existsSync(defaultPath);
  if (!defaultExists) {
    try {
      fs.mkdirSync(defaultPath, { recursive: true });
    } catch {
      // Ignore mkdir failures; callers will handle missing directory.
    }
  }

  if (defaultExists) {
    return defaultPath;
  }
  return defaultPath;
}

/**
 * Get the graphs storage directory (alias for Graphiti storage)
 */
export function getGraphsDir(): string {
  return getMemoriesDir();
}

/**
 * Check if running in an immutable filesystem environment
 * (AppImage, Flatpak, Snap, etc.)
 */
export function isImmutableEnvironment(): boolean {
  return !!(
    process.env.APPIMAGE ||
    process.env.SNAP ||
    process.env.FLATPAK_ID
  );
}

/**
 * Get environment-appropriate path for a given type
 * Handles the differences between regular installs and sandboxed environments
 *
 * @param type - The type of path needed: 'config', 'data', 'cache', 'memories'
 * @returns The appropriate path for the current environment
 */
export function getAppPath(type: 'config' | 'data' | 'cache' | 'memories'): string {
  switch (type) {
    case 'config':
      return getAppConfigDir();
    case 'data':
      return getAppDataDir();
    case 'cache':
      return getAppCacheDir();
    case 'memories':
      return getMemoriesDir();
    default:
      return getAppDataDir();
  }
}
