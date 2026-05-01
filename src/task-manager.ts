import fs from "fs";
import path from "path";
import type {
  PublishTask,
  TasksData,
  TaskFilter,
  TaskStatistics,
  DownloadStatus,
  TranslationStatus,
  RenderStatus,
  PublishStatus,
} from "./types";

const TASKS_FILE = path.join(process.cwd(), "data", "tasks.json");
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================================
// 任务存储管理
// ============================================================

function ensureDataDir(): void {
  const dataDir = path.dirname(TASKS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

export function loadTasks(): TasksData {
  ensureDataDir();

  if (!fs.existsSync(TASKS_FILE)) {
    const emptyData: TasksData = { tasks: [], lastUpdated: Date.now() };
    fs.writeFileSync(TASKS_FILE, JSON.stringify(emptyData, null, 2));
    return emptyData;
  }

  try {
    const raw = fs.readFileSync(TASKS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("[TaskManager] Failed to load tasks:", error);
    return { tasks: [], lastUpdated: Date.now() };
  }
}

export function saveTasks(data: TasksData): void {
  ensureDataDir();
  data.lastUpdated = Date.now();
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
}

export function cleanupExpiredTasks(): number {
  const data = loadTasks();
  const now = Date.now();
  const originalCount = data.tasks.length;

  data.tasks = data.tasks.filter((task) => {
    return now - task.updatedAt < ONE_WEEK_MS;
  });

  const removedCount = originalCount - data.tasks.length;

  if (removedCount > 0) {
    saveTasks(data);
    console.log(`[TaskManager] Cleaned up ${removedCount} expired tasks`);
  }

  return removedCount;
}

// ============================================================
// 任务操作
// ============================================================

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function createTask(
  originalUrl: string,
  initialStatus?: Partial<PublishTask>
): PublishTask {
  const now = Date.now();
  const newTask: PublishTask = {
    id: generateTaskId(),
    originalUrl,
    downloadStatus: initialStatus?.downloadStatus || {
      video: false,
      subtitles: false,
      comments: false,
    },
    translationStatus: initialStatus?.translationStatus || {
      subtitles: "pending",
      comments: "pending",
    },
    renderStatus: initialStatus?.renderStatus || "pending",
    publishStatus: initialStatus?.publishStatus || {},
    createdAt: now,
    updatedAt: now,
  };

  const data = loadTasks();
  data.tasks.push(newTask);
  saveTasks(data);

  return newTask;
}

export function getAllTasks(filter?: TaskFilter): PublishTask[] {
  cleanupExpiredTasks();

  const data = loadTasks();
  let tasks = [...data.tasks];

  if (filter) {
    if (filter.status) {
      tasks = tasks.filter((t) => t.renderStatus === filter.status);
    }
    if (filter.platform) {
      tasks = tasks.filter((t) => !!t.publishStatus[filter.platform!]);
    }
    if (filter.published !== undefined) {
      tasks = tasks.filter((t) => {
        if (filter.platform) {
          return t.publishStatus[filter.platform!]?.published === filter.published;
        }
        return Object.values(t.publishStatus).some(
          (p) => p.published === filter.published
        );
      });
    }
    if (filter.since) {
      tasks = tasks.filter((t) => t.updatedAt >= filter.since!);
    }
  }

  return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getTaskById(taskId: string): PublishTask | null {
  const data = loadTasks();
  return data.tasks.find((t) => t.id === taskId) || null;
}

export function updateTask(
  taskId: string,
  updates: Partial<
    Pick<
      PublishTask,
      "downloadStatus" | "translationStatus" | "renderStatus" | "publishStatus"
    >
  >
): PublishTask | null {
  const data = loadTasks();
  const taskIndex = data.tasks.findIndex((t) => t.id === taskId);

  if (taskIndex === -1) {
    return null;
  }

  const task = data.tasks[taskIndex];

  if (updates.downloadStatus) {
    task.downloadStatus = { ...task.downloadStatus, ...updates.downloadStatus };
  }
  if (updates.translationStatus) {
    task.translationStatus = {
      ...task.translationStatus,
      ...updates.translationStatus,
    };
  }
  if (updates.renderStatus) {
    task.renderStatus = updates.renderStatus;
  }
  if (updates.publishStatus) {
    task.publishStatus = { ...task.publishStatus, ...updates.publishStatus };
  }

  task.updatedAt = Date.now();
  data.tasks[taskIndex] = task;
  saveTasks(data);

  return task;
}

export function deleteTask(taskId: string): boolean {
  const data = loadTasks();
  const originalLength = data.tasks.length;
  data.tasks = data.tasks.filter((t) => t.id !== taskId);

  if (data.tasks.length < originalLength) {
    saveTasks(data);
    return true;
  }
  return false;
}

// ============================================================
// 任务状态计算
// ============================================================

export function isDownloadComplete(status: DownloadStatus): boolean {
  return status.video && status.subtitles && status.comments;
}

export function isTranslationComplete(status: TranslationStatus): boolean {
  return (
    (status.subtitles === "translated" || status.subtitles === "not-needed") &&
    status.comments === "translated"
  );
}

export function isRenderComplete(status: RenderStatus): boolean {
  return status === "completed";
}

export function isPublishComplete(status: PublishStatus): boolean {
  const platforms = Object.keys(status);
  if (platforms.length === 0) return false;
  return Object.values(status).every((p) => p.published);
}

export function isTaskComplete(task: PublishTask): boolean {
  return (
    isDownloadComplete(task.downloadStatus) &&
    isTranslationComplete(task.translationStatus) &&
    isRenderComplete(task.renderStatus) &&
    isPublishComplete(task.publishStatus)
  );
}

export function getTaskProgress(task: PublishTask): {
  download: number;
  translation: number;
  render: number;
  publish: number;
  overall: number;
} {
  const download =
    ((task.downloadStatus.video ? 1 : 0) +
      (task.downloadStatus.subtitles ? 1 : 0) +
      (task.downloadStatus.comments ? 1 : 0)) /
    3;

  let translation = 0;
  if (
    task.translationStatus.subtitles === "not-needed" ||
    task.translationStatus.subtitles === "translated"
  ) {
    translation += 0.5;
  }
  if (task.translationStatus.comments === "translated") {
    translation += 0.5;
  }

  let render = 0;
  if (task.renderStatus === "completed") render = 1;
  else if (task.renderStatus === "rendering") render = 0.5;

  const platforms = Object.keys(task.publishStatus);
  let publish = 0;
  if (platforms.length > 0) {
    publish =
      platforms.filter(
        (p) => task.publishStatus[p as keyof PublishStatus]?.published
      ).length / platforms.length;
  }

  const overall = download * 0.2 + translation * 0.2 + render * 0.3 + publish * 0.3;

  return {
    download: Math.round(download * 100),
    translation: Math.round(translation * 100),
    render: Math.round(render * 100),
    publish: Math.round(publish * 100),
    overall: Math.round(overall * 100),
  };
}

// ============================================================
// 统计信息
// ============================================================

export function getTaskStatistics(): TaskStatistics {
  const tasks = getAllTasks();

  const stats: TaskStatistics = {
    total: tasks.length,
    pending: 0,
    inProgress: 0,
    completed: 0,
    failed: 0,
    byPlatform: {
      bilibili: { published: 0, pending: 0 },
      douyin: { published: 0, pending: 0 },
    },
  };

  for (const task of tasks) {
    if (isTaskComplete(task)) {
      stats.completed++;
    } else {
      switch (task.renderStatus) {
        case "pending":
          stats.pending++;
          break;
        case "rendering":
          stats.inProgress++;
          break;
        case "completed":
          stats.inProgress++;
          break;
        case "failed":
          stats.failed++;
          break;
      }
    }

    if (task.publishStatus.bilibili) {
      if (task.publishStatus.bilibili.published) {
        stats.byPlatform.bilibili.published++;
      } else {
        stats.byPlatform.bilibili.pending++;
      }
    }
    if (task.publishStatus.douyin) {
      if (task.publishStatus.douyin.published) {
        stats.byPlatform.douyin.published++;
      } else {
        stats.byPlatform.douyin.pending++;
      }
    }
  }

  return stats;
}
