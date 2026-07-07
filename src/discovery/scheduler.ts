import { loadSettings } from "../settings";

let timer: NodeJS.Timeout | null = null;

/** 计算到下一个 scheduleHour 的毫秒数 */
function msUntilNextRun(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    // 今天该时刻已过，排到明天
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function startDiscoveryScheduler(runFn: () => Promise<void>): void {
  stopDiscoveryScheduler();
  const schedule = () => {
    const cfg = loadSettings().task.discovery;
    const delay = msUntilNextRun(cfg.scheduleHour);
    timer = setTimeout(async () => {
      if (!loadSettings().task.discovery.enabled) {
        schedule(); // 未启用，跳过本次，继续排下次
        return;
      }
      try {
        await runFn();
      } catch (err) {
        console.error("[discovery] scheduled run failed", err);
      }
      schedule(); // 重新排下次
    }, delay);
  };
  schedule();
}

export function stopDiscoveryScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
