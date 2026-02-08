/**
 * Consilium API
 * ==============
 * 
 * Preload API for Consilium multi-agent orchestrator.
 * Bridges renderer <-> main process IPC for Consilium operations.
 */

import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants/ipc';

export interface ConsiliumAPI {
    // Commands
    consiliumStart: (task: string, projectId?: string, model?: string) => Promise<{ success: boolean; error?: string }>;
    consiliumStop: () => Promise<{ success: boolean; error?: string }>;
    consiliumApprove: () => Promise<{ success: boolean; error?: string }>;
    consiliumReject: (feedback: string) => Promise<{ success: boolean; error?: string }>;
    consiliumGetStatus: () => Promise<{
        status: 'idle' | 'running' | 'waiting_approval' | 'complete' | 'error';
        task?: string;
        outputLength?: number;
    }>;

    // Event listeners
    onConsiliumOutput: (callback: (data: { type: 'stdout' | 'stderr'; data: string }) => void) => () => void;
    onConsiliumPlanReady: (callback: () => void) => () => void;
    onConsiliumComplete: (callback: () => void) => () => void;
    onConsiliumError: (callback: (data: { message: string }) => void) => () => void;
}

export const createConsiliumAPI = (): ConsiliumAPI => ({
    // Commands
    consiliumStart: (task: string, projectId?: string, model?: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.CONSILIUM_START, task, projectId, model),

    consiliumStop: () =>
        ipcRenderer.invoke(IPC_CHANNELS.CONSILIUM_STOP),

    consiliumApprove: () =>
        ipcRenderer.invoke(IPC_CHANNELS.CONSILIUM_APPROVE),

    consiliumReject: (feedback: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.CONSILIUM_REJECT, feedback),

    consiliumGetStatus: () =>
        ipcRenderer.invoke(IPC_CHANNELS.CONSILIUM_GET_STATUS),

    // Event listeners (return cleanup functions)
    onConsiliumOutput: (callback) => {
        const handler = (_event: Electron.IpcRendererEvent, data: { type: 'stdout' | 'stderr'; data: string }) => {
            callback(data);
        };
        ipcRenderer.on(IPC_CHANNELS.CONSILIUM_OUTPUT, handler);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.CONSILIUM_OUTPUT, handler);
    },

    onConsiliumPlanReady: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(IPC_CHANNELS.CONSILIUM_PLAN_READY, handler);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.CONSILIUM_PLAN_READY, handler);
    },

    onConsiliumComplete: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(IPC_CHANNELS.CONSILIUM_COMPLETE, handler);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.CONSILIUM_COMPLETE, handler);
    },

    onConsiliumError: (callback) => {
        const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => {
            callback(data);
        };
        ipcRenderer.on(IPC_CHANNELS.CONSILIUM_ERROR, handler);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.CONSILIUM_ERROR, handler);
    }
});
