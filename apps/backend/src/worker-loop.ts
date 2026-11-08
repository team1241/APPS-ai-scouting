// One in-flight pass per process; shutdown stops new claims and waits for the current pass.
export function startWorkerLoop(pass: () => Promise<unknown>, active: () => boolean) {
  let stopped = false,
    pending: Promise<unknown> | undefined;
  const tick = () => {
    if (stopped || pending || !active()) return;
    pending = pass()
      .catch(() => console.error("Worker pass failed; durable state retained"))
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(tick, 5000);
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
