import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { buildAutostartGroups, startAutostartQueue } from '../ipc-handlers/task/plan-import-autostart';

describe('plan-import autostart helpers', () => {
  it('builds groups from schedule and created tasks', () => {
    const groups = buildAutostartGroups(
      [
        { parallel: true, tasks: ['Task A', 'Task B'] },
        { parallel: false, tasks: ['Task C'] }
      ],
      [
        { id: 'a1', title: 'Task A' },
        { id: 'b1', title: 'Task B' },
        { id: 'c1', title: 'Task C' }
      ]
    );

    expect(groups).toEqual([
      { parallel: true, taskIds: ['a1', 'b1'] },
      { parallel: false, taskIds: ['c1'] }
    ]);
  });

  it('runs groups sequentially, waiting for completions', () => {
    const emitter = new EventEmitter();
    const startTask = vi.fn();

    const controller = startAutostartQueue(
      emitter as unknown as import('../agent').AgentManager,
      [
        { parallel: true, taskIds: ['t1', 't2'] },
        { parallel: false, taskIds: ['t3'] }
      ],
      startTask
    );

    expect(startTask).toHaveBeenCalledWith('t1');
    expect(startTask).toHaveBeenCalledWith('t2');
    expect(startTask).toHaveBeenCalledTimes(2);

    emitter.emit('exit', 't1', 0);
    emitter.emit('exit', 't2', 0);

    expect(startTask).toHaveBeenCalledWith('t3');
    expect(startTask).toHaveBeenCalledTimes(3);
    expect(controller.isCompleted()).toBe(false);
  });

  it('pauses and resumes queue without losing cursor', () => {
    const emitter = new EventEmitter();
    const startTask = vi.fn();

    const controller = startAutostartQueue(
      emitter as unknown as import('../agent').AgentManager,
      [
        { parallel: false, taskIds: ['t1'] },
        { parallel: false, taskIds: ['t2'] }
      ],
      startTask
    );

    expect(startTask).toHaveBeenCalledWith('t1');
    controller.pause('t1');

    expect(controller.isPaused()).toBe(true);
    expect(controller.getState().cursor).toBe(0);

    controller.resume();
    expect(controller.isPaused()).toBe(false);

    emitter.emit('exit', 't1', 0);
    expect(startTask).toHaveBeenCalledWith('t2');
  });

  it('restores from saved state and skips completed tasks', () => {
    const emitter = new EventEmitter();
    const startTask = vi.fn();

    const groups = [
      { parallel: false, taskIds: ['t1'] },
      { parallel: false, taskIds: ['t2', 't3'] }
    ];

    const controller = startAutostartQueue(
      emitter as unknown as import('../agent').AgentManager,
      groups,
      startTask,
      undefined,
      {
        status: 'paused',
        cursor: 1,
        completedTaskIds: ['t2'],
        updatedAt: new Date().toISOString()
      }
    );

    expect(startTask).not.toHaveBeenCalled();

    controller.resume();
    expect(startTask).toHaveBeenCalledTimes(1);
    expect(startTask).toHaveBeenCalledWith('t3');
  });
});
