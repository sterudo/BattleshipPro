export function createAiTurnRunner({ canShoot, shoot, onError, onProcessing, delay = 420 }) {
  let activeRun = null;

  function cancel() {
    const run = activeRun;
    activeRun = null;
    if (run) {
      clearTimeout(run.timer);
      run.resume?.(false);
      onProcessing(false);
    }
  }

  async function start() {
    if (activeRun || !canShoot()) return;
    const run = {};
    activeRun = run;
    onProcessing(true);
    try {
      while (activeRun === run && canShoot()) {
        const elapsed = await new Promise((resolve) => {
          run.resume = resolve;
          run.timer = setTimeout(() => resolve(true), delay);
        });
        if (!elapsed || activeRun !== run || !canShoot()) break;
        shoot();
      }
    } catch (error) {
      if (activeRun === run) onError(error);
    } finally {
      if (activeRun === run) {
        activeRun = null;
        onProcessing(false);
      }
    }
  }

  return { start, cancel };
}
