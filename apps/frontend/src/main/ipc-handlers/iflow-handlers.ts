/**
 * iFlow CLI Handlers
 *
 * IPC handlers for iFlow CLI status checking.
 */

import { ipcMain } from 'electron';
import { execFileSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import type { IPCResult } from '../../shared/types';
import type { IFlowCliStatus } from '../../shared/types/cli';
import { findExecutable } from '../env-utils';
import { readSettingsFile } from '../settings-utils';
import {
  getIflowAccountsPaths,
  getIflowAuthState,
  getIflowOAuthPaths,
  getIflowSettingsPaths,
  hasIflowWebLogin,
  readJsonFile,
  setIflowOAuthResetAt,
  writeJsonFile
} from '../iflow-auth';
import { openTerminalWithCommand } from './claude-code-handlers';

const VERSION_TIMEOUT_MS = 5000;

function resolveIflowCliPath(): string | null {
  const settings = readSettingsFile() as { claudePath?: string } | undefined;
  const configuredPath = settings?.claudePath?.trim();
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }
  return findExecutable('iflow');
}

function parseVersion(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/\d+\.\d+\.\d+/);
  return match ? match[0] : trimmed;
}

/**
 * Register iFlow IPC handlers
 */
export function registerIflowHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.IFLOW_CLI_CHECK,
    async (): Promise<IPCResult<IFlowCliStatus>> => {
      try {
        const cliPath = resolveIflowCliPath();
        const { hasApiKey, hasWebLogin, authType } = getIflowAuthState();
        const permissionMode = process.env.IFLOW_PERMISSION_MODE || 'auto';

        if (!cliPath) {
          return {
            success: true,
            data: {
              installed: null,
              hasApiKey,
              authType,
              hasWebLogin,
              permissionMode
            }
          };
        }

        let version: string | null = null;
        try {
          const rawVersion = execFileSync(cliPath, ['--version'], {
            encoding: 'utf-8',
            timeout: VERSION_TIMEOUT_MS,
            windowsHide: true
          });
          version = parseVersion(rawVersion);
        } catch (error) {
          console.warn('[iFlow] Failed to read CLI version:', error);
        }

        return {
          success: true,
          data: {
            installed: version,
            path: cliPath,
            hasApiKey,
            authType,
            hasWebLogin,
            permissionMode
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[iFlow] Status check failed:', message);
        return {
          success: false,
          error: `Failed to check iFlow status: ${message}`
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.IFLOW_CLI_AUTH,
    async (): Promise<IPCResult<{ opened: boolean }>> => {
      try {
        if (hasIflowWebLogin()) {
          return {
            success: true,
            data: { opened: false }
          };
        }

        const cliPath = resolveIflowCliPath();
        const resolvedCommand = cliPath ? (cliPath.includes(' ') ? `"${cliPath}"` : cliPath) : 'iflow';
        const command = `${resolvedCommand} -i "/auth"`;
        if (!cliPath) {
          console.warn('[iFlow] CLI not found in app PATH, falling back to shell resolution.');
        }
        await openTerminalWithCommand(command);

        return {
          success: true,
          data: { opened: true }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[iFlow] Failed to start web login:', message);
        return {
          success: false,
          error: `Failed to start iFlow web login: ${message}`
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.IFLOW_CLI_RESET_OAUTH,
    async (): Promise<IPCResult<{ cleared: boolean }>> => {
      try {
        for (const credsPath of getIflowOAuthPaths()) {
          rmSync(credsPath, { force: true });
        }

        for (const accountsPath of getIflowAccountsPaths()) {
          const accounts = readJsonFile(accountsPath);
          if (!accounts) {
            continue;
          }
          const updated = { ...accounts };
          updated['active'] = null;
          if ('iflowApiKey' in updated) {
            delete updated['iflowApiKey'];
          }
          writeJsonFile(accountsPath, updated);
        }

        for (const settingsPath of getIflowSettingsPaths()) {
          const cliSettings = readJsonFile(settingsPath);
          if (cliSettings && cliSettings['selectedAuthType'] === 'oauth-iflow') {
            delete cliSettings['selectedAuthType'];
            writeJsonFile(settingsPath, cliSettings);
          }
        }

        setIflowOAuthResetAt(Date.now());

        return {
          success: true,
          data: { cleared: true }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[iFlow] Failed to reset OAuth:', message);
        return {
          success: false,
          error: `Failed to reset iFlow OAuth: ${message}`
        };
      }
    }
  );

  console.warn('[IPC] iFlow handlers registered');
}
