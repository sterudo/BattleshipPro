import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiTurnRunner } from '../src/engine/aiTurnRunner.js';

describe('AI turn lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(shoot = vi.fn()) {
    const state = { mayShoot: true, processing: false };
    const onError = vi.fn();
    const onProcessing = vi.fn((value) => { state.processing = value; });
    const runner = createAiTurnRunner({
      canShoot: () => state.mayShoot,
      shoot,
      onError,
      onProcessing,
    });
    return { runner, state, shoot, onError, onProcessing };
  }

  it('cancels a pending shot before restart or unmount', async () => {
    const { runner, shoot, state } = setup();
    const oldRun = runner.start();
    await vi.advanceTimersByTimeAsync(200);
    runner.cancel();
    await oldRun;
    await vi.advanceTimersByTimeAsync(1000);
    expect(shoot).not.toHaveBeenCalled();
    expect(state.processing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the new match processing flag and timer independent of the old run', async () => {
    const { runner, shoot, state, onProcessing } = setup();
    const oldRun = runner.start();
    await vi.advanceTimersByTimeAsync(200);
    runner.cancel();
    const newRun = runner.start();
    await oldRun;
    expect(state.processing).toBe(true);
    expect(onProcessing.mock.calls.map(([value]) => value)).toEqual([true, false, true]);
    await vi.advanceTimersByTimeAsync(220);
    expect(shoot).not.toHaveBeenCalled();
    expect(state.processing).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(shoot).toHaveBeenCalledTimes(1);
    runner.cancel();
    await newRun;
  });

  it('invalidates a timer that has already resolved before its continuation runs', async () => {
    const { runner, shoot, state } = setup();
    const oldRun = runner.start();
    vi.advanceTimersByTime(420);
    runner.cancel();
    const newRun = runner.start();
    await oldRun;
    expect(shoot).not.toHaveBeenCalled();
    expect(state.processing).toBe(true);
    await vi.advanceTimersByTimeAsync(420);
    expect(shoot).toHaveBeenCalledTimes(1);
    runner.cancel();
    await newRun;
  });

  it('does not start overlapping loops and stops after a miss changes the turn', async () => {
    const context = setup(() => { context.state.mayShoot = false; });
    const running = context.runner.start();
    await context.runner.start();
    await vi.advanceTimersByTimeAsync(420);
    await running;
    expect(context.state.processing).toBe(false);
    expect(context.onProcessing.mock.calls.map(([value]) => value)).toEqual([true, false]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a current-run failure and releases the processing flag', async () => {
    const error = new Error('AI failed');
    const { runner, onError, state } = setup(() => { throw error; });
    const running = runner.start();
    await vi.advanceTimersByTimeAsync(420);
    await running;
    expect(onError).toHaveBeenCalledWith(error);
    expect(state.processing).toBe(false);
  });
});
