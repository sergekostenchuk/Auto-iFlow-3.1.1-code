import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { getSettingsPath, readSettingsFile } from './settings-utils';

const IFLOW_DIRNAME = '.iflow';
const IFLOW_SETTINGS_FILE = 'settings.json';
const IFLOW_OAUTH_CREDS_FILE = 'oauth_creds.json';
const IFLOW_ACCOUNTS_FILE = 'iflow_accounts.json';
const IFLOW_LOG_DIRS = ['log', 'logs'];

const IFLOW_DEFAULT_DIR = path.join(homedir(), IFLOW_DIRNAME);

export interface IflowAuthState {
  hasApiKey: boolean;
  hasWebLogin: boolean;
  authType?: string;
}

export function getIflowBaseDirs(): string[] {
  const dirs = new Set<string>();
  const envDir = process.env.IFLOW_HOME || process.env.IFLOW_DIR;
  if (envDir) {
    dirs.add(envDir);
  }
  dirs.add(IFLOW_DEFAULT_DIR);

  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  dirs.add(path.join(xdgConfigHome, 'iflow'));

  if (process.platform === 'darwin') {
    dirs.add(path.join(homedir(), 'Library', 'Application Support', 'iflow'));
    dirs.add(path.join(homedir(), 'Library', 'Application Support', 'iFlow'));
  }

  return Array.from(dirs);
}

export function getIflowSettingsPaths(): string[] {
  const paths: string[] = [];
  for (const baseDir of getIflowBaseDirs()) {
    paths.push(path.join(baseDir, IFLOW_SETTINGS_FILE));
    paths.push(path.join(baseDir, 'config', IFLOW_SETTINGS_FILE));
  }
  return paths;
}

export function getIflowOAuthPaths(): string[] {
  const paths: string[] = [];
  const oauthFiles = [
    IFLOW_OAUTH_CREDS_FILE,
    'credentials.json',
    'auth.json'
  ];
  for (const baseDir of getIflowBaseDirs()) {
    for (const filename of oauthFiles) {
      paths.push(path.join(baseDir, filename));
      paths.push(path.join(baseDir, 'config', filename));
    }
  }
  return paths;
}

export function getIflowAccountsPaths(): string[] {
  const paths: string[] = [];
  for (const baseDir of getIflowBaseDirs()) {
    paths.push(path.join(baseDir, IFLOW_ACCOUNTS_FILE));
    paths.push(path.join(baseDir, 'config', IFLOW_ACCOUNTS_FILE));
  }
  return paths;
}

export function readJsonFile(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getIflowLogDirs(): string[] {
  const dirs: string[] = [];
  for (const baseDir of getIflowBaseDirs()) {
    for (const logDir of IFLOW_LOG_DIRS) {
      dirs.push(path.join(baseDir, logDir));
    }
  }
  return dirs;
}

function getIflowLogFiles(): string[] {
  const files: { path: string; mtime: number }[] = [];
  for (const dir of getIflowLogDirs()) {
    if (!existsSync(dir)) {
      continue;
    }
    try {
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.log')) {
          continue;
        }
        const fullPath = path.join(dir, entry);
        try {
          const stats = statSync(fullPath);
          if (stats.isFile()) {
            files.push({ path: fullPath, mtime: stats.mtimeMs });
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return files
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => entry.path);
}

function parseLogTimestamp(line: string): number | null {
  const match = line.match(/^\[([0-9]{4}-[0-9]{2}-[0-9]{2}T[^\]]+)\]/);
  if (!match) {
    return null;
  }
  const parsed = Date.parse(match[1]);
  return Number.isNaN(parsed) ? null : parsed;
}

function hasIflowLogAuth(authType: string, resetAt?: number): boolean {
  const files = getIflowLogFiles();
  if (files.length === 0) {
    return false;
  }

  const authPattern = new RegExp(`Authenticated via ["']?${escapeRegExp(authType)}["']?`);

  for (const filePath of files) {
    let fileStats: ReturnType<typeof statSync> | null = null;
    try {
      fileStats = statSync(filePath);
    } catch {
      fileStats = null;
    }

    if (resetAt && fileStats && fileStats.mtimeMs < resetAt) {
      continue;
    }

    let content = '';
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    if (!content) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (!authPattern.test(line)) {
        continue;
      }
      if (!resetAt) {
        return true;
      }
      const timestamp = parseLogTimestamp(line);
      if (timestamp && timestamp >= resetAt) {
        return true;
      }
      if (!timestamp && fileStats && fileStats.mtimeMs >= resetAt) {
        return true;
      }
    }
  }

  return false;
}

function getIflowCliSettings(): Record<string, unknown>[] {
  const settingsList: Record<string, unknown>[] = [];
  for (const settingsPath of getIflowSettingsPaths()) {
    const settings = readJsonFile(settingsPath);
    if (settings) {
      settingsList.push(settings);
    }
  }
  return settingsList;
}

function getIflowCliAuthType(): string | undefined {
  for (const settings of getIflowCliSettings()) {
    const authType = settings['selectedAuthType'];
    if (typeof authType === 'string' && authType.trim().length > 0) {
      return authType;
    }
  }
  return undefined;
}

function hasIflowCliApiKey(): boolean {
  for (const settings of getIflowCliSettings()) {
    const apiKey = settings['apiKey'];
    if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
      return true;
    }
    const legacyKey = settings['iflowApiKey'];
    if (typeof legacyKey === 'string' && legacyKey.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function hasTokenLikeValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some(hasTokenLikeValue);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        return true;
      }
      if (/token|key|secret|auth/i.test(key)) {
        return hasTokenLikeValue(entry);
      }
      return hasTokenLikeValue(entry);
    });
  }
  return false;
}

function hasIflowOAuthCredentials(): boolean {
  for (const credsPath of getIflowOAuthPaths()) {
    if (!existsSync(credsPath)) {
      continue;
    }

    try {
      const raw = readFileSync(credsPath, 'utf-8').trim();
      if (!raw) {
        continue;
      }

      try {
        const creds = JSON.parse(raw) as Record<string, unknown>;
        if (hasTokenLikeValue(creds)) {
          return true;
        }
      } catch {
        return true;
      }

      if (statSync(credsPath).size > 0) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

function hasIflowAccounts(): boolean {
  for (const accountsPath of getIflowAccountsPaths()) {
    const accounts = readJsonFile(accountsPath);
    if (!accounts) {
      continue;
    }

    const active = accounts['active'];
    if (typeof active === 'string' && active.trim().length > 0) {
      return true;
    }

    const lists = [accounts['accounts'], accounts['profiles'], accounts['old']];
    if (lists.some((list) => Array.isArray(list) && list.length > 0)) {
      return true;
    }
  }

  return false;
}

export function hasIflowWebLogin(resetAt?: number): boolean {
  const cliAuthType = getIflowCliAuthType();
  if (cliAuthType === 'oauth-iflow') {
    return true;
  }
  if (cliAuthType === 'iflow' && hasIflowCliApiKey()) {
    // Newer iFlow CLI versions persist web login tokens as apiKey under auth type "iflow".
    return true;
  }
  if (hasIflowOAuthCredentials() || hasIflowAccounts()) {
    return true;
  }
  if (hasIflowLogAuth('oauth-iflow', resetAt)) {
    return true;
  }
  return hasIflowLogAuth('iflow', resetAt);
}

export function getIflowAuthType(hasWebLogin: boolean, hasApiKey: boolean): string | undefined {
  const cliAuthType = getIflowCliAuthType();
  if (cliAuthType) {
    if (cliAuthType === 'iflow' && !hasApiKey && hasWebLogin) {
      return 'oauth-iflow';
    }
    return cliAuthType;
  }
  if (hasWebLogin) {
    return 'oauth-iflow';
  }
  return hasApiKey ? 'iflow' : undefined;
}

export function getIflowAuthState(): IflowAuthState {
  const settings = readSettingsFile() as { globalIflowApiKey?: string; iflowOAuthResetAt?: number } | undefined;
  const resetAt = typeof settings?.iflowOAuthResetAt === 'number' ? settings.iflowOAuthResetAt : undefined;
  const hasApiKey = Boolean(settings?.globalIflowApiKey?.trim()) || hasIflowCliApiKey();
  const hasWebLogin = hasIflowWebLogin(resetAt);
  const authType = getIflowAuthType(hasWebLogin, hasApiKey);

  return { hasApiKey, hasWebLogin, authType };
}

export function hasIflowAuth(): boolean {
  const state = getIflowAuthState();
  return state.hasApiKey || state.hasWebLogin;
}

export function setIflowOAuthResetAt(timestamp: number): void {
  const settingsPath = getSettingsPath();
  const settings = readSettingsFile() || {};
  const updated = { ...settings, iflowOAuthResetAt: timestamp };
  writeJsonFile(settingsPath, updated as Record<string, unknown>);
}
