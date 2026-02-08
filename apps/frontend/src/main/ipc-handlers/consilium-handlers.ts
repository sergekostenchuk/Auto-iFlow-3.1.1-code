/**
 * Consilium IPC Handlers
 * ========================
 * 
 * Handles IPC communication between Electron renderer and the
 * Python ConsiliumOrchestrator backend.
 * 
 * Features:
 * - Detailed logging for debugging
 * - Session management with message continuation
 * - Context preservation
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import { projectStore } from '../project-store';

// Logger helper for consistent format
const log = (action: string, data?: any) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    console.log(`[${timestamp}] [Consilium] ${action}`, data || '');
};

const logError = (action: string, error: any) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    console.error(`[${timestamp}] [Consilium] ERROR ${action}:`, error);
};

interface ConsiliumSession {
    process: ChildProcess | null;
    status: 'idle' | 'running' | 'waiting_approval' | 'error' | 'complete';
    task: string;
    output: string[];
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// Global session state (single session for now)
let currentSession: ConsiliumSession = {
    process: null,
    status: 'idle',
    task: '',
    output: [],
    history: []
};

/**
 * Get the path to the Python interpreter and run_consilium.py
 */
function getConsiliumPaths(pythonPath?: string, autoBuildPath?: string): { python: string; script: string; cwd: string } {
    let python = pythonPath;
    if (!python) {
        const homebrewPython = '/opt/homebrew/bin/python3.11';
        const fs = require('fs');
        if (fs.existsSync(homebrewPython)) {
            python = homebrewPython;
        } else {
            python = 'python3';
        }
    }

    const backendPath = autoBuildPath || join(__dirname, '../../../../apps/backend');

    const result = {
        python,
        script: join(backendPath, 'run_consilium.py'),
        cwd: backendPath
    };

    log('Resolved paths:', result);
    return result;
}

/**
 * Register all Consilium-related IPC handlers
 */
export function registerConsiliumHandlers(
    getMainWindow: () => BrowserWindow | null,
    pythonPath?: string,
    autoBuildPath?: string
): void {
    const paths = getConsiliumPaths(pythonPath, autoBuildPath);

    // ============================================
    // CONSILIUM_START - Start or continue session
    // ============================================
    ipcMain.handle(
        IPC_CHANNELS.CONSILIUM_START,
        async (_, task: string, projectId?: string, model?: string): Promise<IPCResult> => {
            log('START called', { task: task.slice(0, 50), projectId, model });

            try {
                const mainWindow = getMainWindow();
                if (!mainWindow) {
                    logError('START', 'Main window not available');
                    return { success: false, error: 'Main window not available' };
                }

                // If session is running, send as continuation message
                if (currentSession.process && currentSession.status !== 'idle') {
                    log('Session active, sending as continuation', {
                        status: currentSession.status,
                        pid: currentSession.process.pid
                    });

                    // Add to history
                    currentSession.history.push({ role: 'user', content: task });

                    // Send to process stdin
                    currentSession.process.stdin?.write(`${task}\n`);
                    currentSession.status = 'running';

                    log('Message sent to process stdin');
                    return { success: true, data: { continued: true } };
                }

                // Start new session
                log('Starting new session');

                currentSession = {
                    process: null,
                    status: 'running',
                    task,
                    output: [],
                    history: [{ role: 'user', content: task }]
                };

                const project = projectId ? projectStore.getProject(projectId) : undefined;
                const projectName = project?.name || task;

                const args = ['--task', task, '--project-name', projectName];
                if (model) {
                    args.push('--model', model);
                }

                log('Spawn args:', args);

                // Check if script exists
                const fs = require('fs');
                if (!fs.existsSync(paths.script)) {
                    const error = `Script not found: ${paths.script}`;
                    logError('START', error);
                    currentSession.status = 'error';
                    mainWindow.webContents.send(IPC_CHANNELS.CONSILIUM_ERROR, { message: error });
                    return { success: false, error };
                }

                // Spawn Python process
                const proc = spawn(paths.python, [paths.script, ...args], {
                    cwd: paths.cwd,
                    env: { ...process.env, PYTHONUNBUFFERED: '1' }
                });

                log('Process spawned', { pid: proc.pid });
                currentSession.process = proc;

                // Handle stdout
                proc.stdout?.on('data', (data: Buffer) => {
                    const text = data.toString();
                    const waitingMarker = '[CONSILIUM_WAITING_FOR_USER]';
                    const hasWaitingMarker = text.includes(waitingMarker);
                    const cleanedText = text.replace(waitingMarker, '');
                    log('STDOUT', text.slice(0, 100) + (text.length > 100 ? '...' : ''));

                    if (cleanedText.trim().length > 0) {
                        currentSession.output.push(cleanedText);
                        currentSession.history.push({ role: 'assistant', content: cleanedText });
                    }

                    if (cleanedText.trim().length > 0) {
                        mainWindow.webContents.send(IPC_CHANNELS.CONSILIUM_OUTPUT, {
                            type: 'stdout',
                            data: cleanedText
                        });
                    }

                    // Check for approval prompt
                    if (hasWaitingMarker ||
                        text.includes('Одобряете план') ||
                        text.includes('approve this plan') ||
                        text.includes('Your choice') ||
                        text.includes('[Approve]')) {
                        log('Plan ready, waiting for approval');
                        currentSession.status = 'waiting_approval';
                        mainWindow.webContents.send(IPC_CHANNELS.CONSILIUM_PLAN_READY, {
                            output: currentSession.output.join('')
                        });
                    }
                });

                // Handle stderr
                proc.stderr?.on('data', (data: Buffer) => {
                    const text = data.toString();
                    log('STDERR', text.slice(0, 200));

                    currentSession.output.push(text);
                    mainWindow.webContents.send(IPC_CHANNELS.CONSILIUM_OUTPUT, {
                        type: 'stderr',
                        data: text
                    });
                });

                // Handle process exit
                proc.on('close', (code: number | null) => {
                    log('Process closed', { code, status: currentSession.status });

                    const wasRunning = currentSession.status !== 'idle';
                    currentSession.status = 'complete';
                    currentSession.process = null;

                    if (wasRunning) {
                        mainWindow.webContents.send(IPC_CHANNELS.CONSILIUM_COMPLETE, {
                            exitCode: code,
                            output: currentSession.output.join('')
                        });
                    }
                });

                // Handle process error
                proc.on('error', (error: Error) => {
                    logError('Process error', error);
                    currentSession.status = 'error';
                    mainWindow.webContents.send(IPC_CHANNELS.CONSILIUM_ERROR, {
                        message: error.message
                    });
                });

                return { success: true, data: { message: 'Consilium session started', pid: proc.pid } };
            } catch (error) {
                logError('START exception', error);
                currentSession.status = 'error';
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Failed to start Consilium'
                };
            }
        }
    );

    // ============================================
    // CONSILIUM_STOP - Stop session
    // ============================================
    ipcMain.handle(
        IPC_CHANNELS.CONSILIUM_STOP,
        async (): Promise<IPCResult> => {
            log('STOP called', { status: currentSession.status, pid: currentSession.process?.pid });

            try {
                if (currentSession.process) {
                    log('Killing process');
                    currentSession.process.kill('SIGTERM');

                    // Force kill after 2 seconds if still alive
                    setTimeout(() => {
                        if (currentSession.process) {
                            log('Force killing process');
                            currentSession.process.kill('SIGKILL');
                        }
                    }, 2000);
                }

                currentSession.status = 'idle';
                currentSession.process = null;
                // Keep output and history for review

                log('Session stopped');
                return { success: true };
            } catch (error) {
                logError('STOP exception', error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Failed to stop Consilium'
                };
            }
        }
    );

    // ============================================
    // CONSILIUM_APPROVE - Approve plan
    // ============================================
    ipcMain.handle(
        IPC_CHANNELS.CONSILIUM_APPROVE,
        async (): Promise<IPCResult> => {
            log('APPROVE called', { status: currentSession.status });

            try {
                if (!currentSession.process) {
                    logError('APPROVE', 'No process running');
                    return { success: false, error: 'No active session' };
                }

                log('Sending approval to stdin');
                currentSession.process.stdin?.write('да\n'); // Russian "yes"
                currentSession.status = 'running';
                currentSession.history.push({ role: 'user', content: 'да (одобрено)' });

                return { success: true };
            } catch (error) {
                logError('APPROVE exception', error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Failed to approve plan'
                };
            }
        }
    );

    // ============================================
    // CONSILIUM_REJECT - Reject plan with feedback
    // ============================================
    ipcMain.handle(
        IPC_CHANNELS.CONSILIUM_REJECT,
        async (_, feedback?: string): Promise<IPCResult> => {
            log('REJECT called', { feedback: feedback?.slice(0, 50), status: currentSession.status });

            try {
                if (!currentSession.process) {
                    logError('REJECT', 'No process running');
                    return { success: false, error: 'No active session' };
                }

                const response = feedback || 'нет';
                log('Sending rejection to stdin:', response);
                currentSession.process.stdin?.write(`${response}\n`);
                currentSession.status = 'running';
                currentSession.history.push({ role: 'user', content: response });

                return { success: true };
            } catch (error) {
                logError('REJECT exception', error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Failed to reject plan'
                };
            }
        }
    );

    // ============================================
    // CONSILIUM_GET_STATUS - Get session info
    // ============================================
    ipcMain.handle(
        IPC_CHANNELS.CONSILIUM_GET_STATUS,
        async (): Promise<IPCResult<{ status: string; task: string; outputLength: number; historyLength: number }>> => {
            log('GET_STATUS called');

            return {
                success: true,
                data: {
                    status: currentSession.status,
                    task: currentSession.task,
                    outputLength: currentSession.output.length,
                    historyLength: currentSession.history.length
                }
            };
        }
    );

    // ============================================
    // CONSILIUM_CLEAR - Clear session completely
    // ============================================
    ipcMain.handle(
        'consilium:clear',
        async (): Promise<IPCResult> => {
            log('CLEAR called');

            if (currentSession.process) {
                currentSession.process.kill('SIGTERM');
            }

            currentSession = {
                process: null,
                status: 'idle',
                task: '',
                output: [],
                history: []
            };

            log('Session cleared');
            return { success: true };
        }
    );

    log('All handlers registered');
}
