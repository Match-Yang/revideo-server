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
