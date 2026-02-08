/**
 * iFlow API for renderer process
 *
 * Provides access to iFlow CLI status information.
 */

import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants/ipc';
import type { IPCResult } from '../../../shared/types';
import type { IFlowCliStatus } from '../../../shared/types/cli';

/**
 * iFlow API interface exposed to renderer
 */
export interface IFlowAPI {
  /**
   * Check iFlow CLI status and API key configuration
   */
  checkIflowStatus: () => Promise<IPCResult<IFlowCliStatus>>;
  /**
   * Launch iFlow CLI web login flow in a terminal
   */
  startIflowWebLogin: () => Promise<IPCResult<{ opened: boolean }>>;
  /**
   * Clear iFlow OAuth credentials stored on disk
   */
  resetIflowOAuth: () => Promise<IPCResult<{ cleared: boolean }>>;
}

/**
 * Creates the iFlow API implementation
 */
export const createIFlowAPI = (): IFlowAPI => ({
  checkIflowStatus: (): Promise<IPCResult<IFlowCliStatus>> =>
    ipcRenderer.invoke(IPC_CHANNELS.IFLOW_CLI_CHECK),
  startIflowWebLogin: (): Promise<IPCResult<{ opened: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.IFLOW_CLI_AUTH),
  resetIflowOAuth: (): Promise<IPCResult<{ cleared: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.IFLOW_CLI_RESET_OAUTH)
});
