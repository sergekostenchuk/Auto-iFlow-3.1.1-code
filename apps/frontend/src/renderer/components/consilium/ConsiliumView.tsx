/**
 * Consilium View Component
 * ==========================
 * 
 * Multi-agent orchestrator interface for interactive task planning.
 * Features:
 * - Task description input
 * - Live streaming output
 * - Interactive chat for clarifying requirements
 * - Plan approval/rejection flow
 */

import { useState, useEffect, useRef } from 'react';
import {
    Users,
    Loader2,
    CheckCircle2,
    XCircle,
    Terminal,
    Play,
    Square,
    AlertCircle,
    Bot,
    Lightbulb,
    Send,
    MessageSquare
} from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';

interface ConsiliumViewProps {
    projectId: string;
}

type SessionStatus = 'idle' | 'running' | 'waiting_approval' | 'error' | 'complete';

export function ConsiliumView({ projectId }: ConsiliumViewProps) {
    const [taskInput, setTaskInput] = useState('');
    const [chatInput, setChatInput] = useState('');
    const [selectedModel, setSelectedModel] = useState('glm-4.7');
    const [status, setStatus] = useState<SessionStatus>('idle');
    const [output, setOutput] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const outputEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll output
    useEffect(() => {
        outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [output]);

    // Setup IPC listeners for Consilium events
    useEffect(() => {
        const api = window.electronAPI;
        const cleanups: (() => void)[] = [];

        if (api.onConsiliumOutput) {
            const cleanup = api.onConsiliumOutput((data: { type: string; data: string }) => {
                setOutput((prev) => [...prev, data.data]);
            });
            cleanups.push(cleanup);
        }

        if (api.onConsiliumPlanReady) {
            const cleanup = api.onConsiliumPlanReady(() => {
                setStatus('waiting_approval');
            });
            cleanups.push(cleanup);
        }

        if (api.onConsiliumComplete) {
            const cleanup = api.onConsiliumComplete(() => {
                setStatus('complete');
            });
            cleanups.push(cleanup);
        }

        if (api.onConsiliumError) {
            const cleanup = api.onConsiliumError((data: { message: string }) => {
                setStatus('error');
                setError(data.message);
            });
            cleanups.push(cleanup);
        }

        return () => {
            cleanups.forEach((cleanup) => cleanup());
        };
    }, []);

    const handleStart = async () => {
        if (!taskInput.trim()) return;

        setStatus('running');
        setOutput([]);
        setError(null);

        try {
            // Pass selectedModel to backend
            const result = await window.electronAPI.consiliumStart(taskInput, projectId, selectedModel);
            if (!result.success) {
                setStatus('error');
                setError(result.error || 'Failed to start');
            }
        } catch (err) {
            setStatus('error');
            setError(err instanceof Error ? err.message : 'Failed to start');
        }
    };

    const handleStop = async () => {
        try {
            await window.electronAPI.consiliumStop();
            setStatus('idle');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to stop');
        }
    };

    const handleSendMessage = async () => {
        if (!chatInput.trim()) return;

        // Add user message to output
        const userMsg = `\n👤 ВЫ: ${chatInput}\n\n`;
        setOutput((prev) => [...prev, userMsg]);

        // Clear input
        const message = chatInput;
        setChatInput('');

        try {
            // Send message through the same consiliumStart channel
            // The backend will continue the conversation
            const result = await window.electronAPI.consiliumStart(message);
            if (!result.success) {
                setError(result.error || 'Ошибка отправки');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Ошибка отправки');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleApprove = async () => {
        try {
            await window.electronAPI.consiliumApprove();
            setStatus('running');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to approve');
        }
    };

    const handleReject = async () => {
        const feedback = window.prompt('Укажите причину или предложения:');
        try {
            await window.electronAPI.consiliumReject(feedback || '');
            setStatus('running');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to reject');
        }
    };

    const isRunning = status === 'running' || status === 'waiting_approval';
    const canChat = status === 'complete' || status === 'running';

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Users className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-foreground">Consilium</h2>
                        <p className="text-sm text-muted-foreground">
                            Мультиагентный оркестратор (Планирование → Выполнение → Проверка)
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant={status === 'idle' ? 'secondary' : status === 'error' ? 'destructive' : 'default'}>
                        {status === 'idle' && 'Готов'}
                        {status === 'running' && 'Работает...'}
                        {status === 'waiting_approval' && 'Ожидает ответа'}
                        {status === 'complete' && 'Завершено'}
                        {status === 'error' && 'Ошибка'}
                    </Badge>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Panel: Task Input & Controls */}
                <div className="w-1/3 border-r border-border p-4 flex flex-col gap-4">

                    {/* Model Selection */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <Bot className="h-4 w-4" />
                                Модель iFlow
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <select
                                className="w-full flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                disabled={isRunning}
                            >
                                <option value="glm-4.7">GLM-4.7 (Рекомендуется)</option>
                                <option value="iflow-rome-30ba3b">iFlow-ROME-30BA3B (Preview)</option>
                                <option value="deepseek-v3.2">DeepSeek-V3.2</option>
                                <option value="qwen3-coder-plus">Qwen3-Coder-Plus</option>
                                <option value="kimi-k2-thinking">Kimi-K2-Thinking</option>
                                <option value="minimax-m2.1">MiniMax-M2.1</option>
                                <option value="kimi-k2-0905">Kimi-K2-0905</option>
                            </select>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <Lightbulb className="h-4 w-4" />
                                Описание задачи
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                ref={textareaRef}
                                value={taskInput}
                                onChange={(e) => setTaskInput(e.target.value)}
                                placeholder="Опишите что вы хотите создать..."
                                className="min-h-[120px] resize-none"
                                disabled={isRunning}
                            />
                            <div className="mt-3 flex gap-2">
                                {!isRunning ? (
                                    <Button
                                        onClick={handleStart}
                                        disabled={!taskInput.trim()}
                                        className="flex-1"
                                    >
                                        <Play className="mr-2 h-4 w-4" />
                                        Начать
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={handleStop}
                                        variant="destructive"
                                        className="flex-1"
                                    >
                                        <Square className="mr-2 h-4 w-4" />
                                        Стоп
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Approval Controls */}
                    {status === 'waiting_approval' && (
                        <Card className="border-amber-500/50 bg-amber-500/10">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2 text-amber-500">
                                    <AlertCircle className="h-4 w-4" />
                                    Ожидается ваш ответ
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground mb-3">
                                    Ответьте на вопрос в чате ниже или используйте быстрые кнопки.
                                </p>
                                <div className="flex gap-2">
                                    <Button onClick={handleApprove} variant="default" className="flex-1">
                                        <CheckCircle2 className="mr-2 h-4 w-4" />
                                        Дальше
                                    </Button>
                                    <Button onClick={handleReject} variant="outline" className="flex-1">
                                        <XCircle className="mr-2 h-4 w-4" />
                                        Уточнить
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Error Display */}
                    {error && (
                        <Card className="border-destructive/50 bg-destructive/10">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-2 text-destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <span className="text-sm font-medium">Ошибка</span>
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground">{error}</p>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Right Panel: Output Terminal + Chat Input */}
                <div className="flex-1 flex flex-col">
                    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                        <Terminal className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Диалог с AI</span>
                    </div>

                    {/* Output Area */}
                    <ScrollArea className="flex-1 p-4">
                        <div className="font-mono text-sm whitespace-pre-wrap">
                            {output.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                                    <Bot className="h-12 w-12 text-muted-foreground mb-4" />
                                    <p className="text-muted-foreground">
                                        Введите описание задачи и нажмите "Начать"
                                    </p>
                                </div>
                            ) : (
                                output.map((line, i) => (
                                    <div key={i} className={cn(
                                        'py-0.5',
                                        line.startsWith('ERROR') && 'text-destructive',
                                        line.startsWith('⚠️') && 'text-amber-500',
                                        line.startsWith('👤 ВЫ:') && 'text-primary font-semibold bg-primary/10 px-2 py-1 rounded',
                                    )}>
                                        {line}
                                    </div>
                                ))
                            )}
                            <div ref={outputEndRef} />
                        </div>
                    </ScrollArea>

                    {/* Chat Input - Always visible when session active */}
                    {(isRunning || status === 'complete') && (
                        <div className="border-t border-border p-4">
                            <div className="flex gap-2">
                                <Input
                                    ref={chatInputRef}
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Уточните требования, задайте вопрос или дайте указания..."
                                    className="flex-1"
                                />
                                <Button
                                    onClick={handleSendMessage}
                                    disabled={!chatInput.trim()}
                                    size="icon"
                                >
                                    <Send className="h-4 w-4" />
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                                Enter для отправки • Уточняйте детали, меняйте направление, просите дополнить
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Status Bar */}
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
                <span>Проект: {projectId}</span>
                {isRunning && (
                    <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Обработка...
                    </span>
                )}
            </div>
        </div>
    );
}

export default ConsiliumView;
