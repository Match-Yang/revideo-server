export interface Comment {
  id: string;
  parent: string;
  text: string;
  like_count: number;
  author_id: string;
  author: string;
  author_thumbnail: string;
  author_is_uploader: boolean;
  author_is_verified: boolean;
  is_favorited: boolean;
  _time_text: string;
  timestamp: number;
  is_pinned: boolean;
  replies?: Comment[];
}

export interface CommentsData {
  id: string;
  title: string;
  duration: number;
  comments: Comment[];
  thumbnail?: string;
  channel?: string;
  [key: string]: unknown;
}

export interface DirInfo {
  name: string;
  path: string;
  videoFile?: string;
  audioFiles: string[];
  commentFile?: string;
  subtitleFiles: string[];
}

// ============================================================
// 发布任务管理类型
// ============================================================

export interface DownloadStatus {
  video: boolean;
  subtitles: boolean;
  comments: boolean;
}

export interface TranslationStatus {
  subtitles: "not-needed" | "translated" | "pending";
  comments: "pending" | "translated";
}

export interface PlatformPublishStatus {
  title: string;
  description: string;
  published: boolean;
}

export interface BilibiliPublishStatus extends PlatformPublishStatus {
  tags: string[];
  category?: string;
}

export interface PublishStatus {
  bilibili?: BilibiliPublishStatus;
  douyin?: PlatformPublishStatus;
}

export type RenderStatus = "pending" | "queued" | "rendering" | "completed" | "failed";

export interface PublishTask {
  id: string;
  originalUrl: string;
  requirement?: string;
  downloadStatus: DownloadStatus;
  translationStatus: TranslationStatus;
  renderStatus: RenderStatus;
  publishStatus: PublishStatus;
  createdAt: number;
  updatedAt: number;
}

export interface TasksData {
  tasks: PublishTask[];
  lastUpdated: number;
}

export interface AddTaskRequest {
  originalUrl: string;
  requirement?: string;
  initialStatus?: Partial<PublishTask>;
}

export interface UpdateTaskRequest {
  videoId: string;
  updates: Partial<
    Pick<
      PublishTask,
      "downloadStatus" | "translationStatus"
    >
  >;
}

export interface TaskFilter {
  status?: RenderStatus;
  platform?: "bilibili" | "douyin";
  published?: boolean;
  since?: number;
}

export interface TaskStatistics {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  byPlatform: {
    bilibili: { published: number; pending: number };
    douyin: { published: number; pending: number };
  };
}
