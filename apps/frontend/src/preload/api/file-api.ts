import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';

export interface FileAPI {
  // File Explorer Operations
  listDirectory: (dirPath: string) => Promise<IPCResult<import('../../shared/types').FileNode[]>>;
  readFile: (filePath: string) => Promise<IPCResult<string>>;
  openPath: (targetPath: string) => Promise<IPCResult<void>>;
}

export const createFileAPI = (): FileAPI => ({
  // File Explorer Operations
  listDirectory: (dirPath: string): Promise<IPCResult<import('../../shared/types').FileNode[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_EXPLORER_LIST, dirPath),
  readFile: (filePath: string): Promise<IPCResult<string>> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_EXPLORER_READ, filePath),
  openPath: (targetPath: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_EXPLORER_OPEN, targetPath)
});
