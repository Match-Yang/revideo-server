import React, { useMemo, useState, useEffect } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  OffthreadVideo,
  staticFile,
  continueRender,
  delayRender,
} from "remotion";
import { z } from "zod";
import type { Comment, CommentsData } from "./types";

export const videoCommentsSchema = z.object({
  dirPath: z.string(),
  videoFile: z.string(),
  commentFile: z.string(),
  subtitleFiles: z.array(z.string()),
  durationInFrames: z.number().optional(),
});

export type VideoCommentsProps = z.infer<typeof videoCommentsSchema>;

const COMMENT_ITEM_HEIGHT = 160;
const COMMENT_ITEM_GAP = 16;

// ---- VTT Parser ----

interface SubtitleCue {
  start: number; // seconds
  end: number;   // seconds
  text: string;
}

function parseVTT(vttText: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = vttText.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;

    const match = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
    );
    if (!match) continue;

    const start =
      +match[1] * 3600 + +match[2] * 60 + +match[3] + +match[4] / 1000;
    const end =
      +match[5] * 3600 + +match[6] * 60 + +match[7] + +match[8] / 1000;

    // Collect text lines, strip karaoke tags, pick the clean/summary line
    const textLines = lines
      .filter((l) => !l.includes("-->") && !l.startsWith("WEBVTT") && !l.startsWith("Kind:") && !l.startsWith("Language:"))
      .map((l) => l.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "").replace(/<\/?c>/g, "").trim())
      .filter(Boolean);

    // Use the last clean line (the cumulative/summary line in YouTube VTT)
    const text = textLines[textLines.length - 1] || "";
    if (text) {
      cues.push({ start, end, text });
    }
  }

  // Deduplicate: remove consecutive cues with identical text
  const deduped: SubtitleCue[] = [];
  for (const cue of cues) {
    if (deduped.length === 0 || deduped[deduped.length - 1].text !== cue.text) {
      deduped.push(cue);
    }
  }

  return deduped;
}

function SubtitleOverlay({ cues }: { cues: SubtitleCue[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const activeCue = useMemo(
    () => cues.find((c) => currentTime >= c.start && currentTime <= c.end),
    [cues, currentTime],
  );

  if (!activeCue) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: "5%",
        right: "5%",
        textAlign: "center",
      }}
    >
      <span
        style={{
          display: "inline-block",
          color: "#fff",
          fontSize: 32,
          lineHeight: 1.4,
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          padding: "6px 16px",
          borderRadius: 6,
          textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
        }}
      >
        {activeCue.text}
      </span>
    </div>
  );
}

// ---- Comment Components ----

function CommentItem({ comment }: { comment: Comment }) {
  const replyCount = comment.replies?.length ?? 0;

  return (
    <div
      style={{
        display: "flex",
        gap: 24,
        padding: "20px 32px",
        backgroundColor: "#1a1a1a",
        borderRadius: 8,
        minHeight: COMMENT_ITEM_HEIGHT,
        alignItems: "flex-start",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          flexShrink: 0,
          backgroundColor: "#555",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#999",
          fontSize: 36,
          fontWeight: 700,
        }}
      >
        <img
          src={comment.author_thumbnail}
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            objectFit: "cover",
          }}
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            const target = e.target as HTMLImageElement;
            target.style.display = "none";
          }}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              color: "#aaa",
              fontSize: 26,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 600,
            }}
          >
            {comment.author}
          </span>
          {comment.author_is_uploader && (
            <span
              style={{
                color: "#fff",
                fontSize: 20,
                backgroundColor: "#555",
                padding: "2px 12px",
                borderRadius: 8,
              }}
            >
              UP主
            </span>
          )}
        </div>
        <p
          style={{
            color: "#fff",
            fontSize: 28,
            lineHeight: 1.4,
            margin: 0,
            wordBreak: "break-word",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {comment.text}
        </p>
        <div
          style={{
            display: "flex",
            gap: 32,
            marginTop: 8,
            color: "#888",
            fontSize: 24,
          }}
        >
          <span>{comment.like_count > 0 ? `👍 ${comment.like_count}` : "👍"}</span>
          {replyCount > 0 && <span>💬 {replyCount}条回复</span>}
        </div>
      </div>
    </div>
  );
}

function CommentsList({ comments }: { comments: Comment[] }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const BOTTOM_PADDING = 50;
  const TOP_PADDING = 8;

  const itemsHeight =
    comments.length * COMMENT_ITEM_HEIGHT +
    Math.max(0, comments.length - 1) * COMMENT_ITEM_GAP;
  const totalContentHeight = TOP_PADDING + itemsHeight + BOTTOM_PADDING;

  const visibleHeight = 1280;
  const maxScroll = Math.max(0, totalContentHeight - visibleHeight);

  const scrollY = interpolate(
    frame,
    [0, durationInFrames - 1],
    [0, -maxScroll],
  );

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: "10%",
        right: "10%",
        display: "flex",
        flexDirection: "column",
        gap: COMMENT_ITEM_GAP,
        paddingTop: TOP_PADDING,
        transform: `translateY(${scrollY}px)`,
      }}
    >
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} />
      ))}
      <div style={{ height: BOTTOM_PADDING, flexShrink: 0 }} />
    </div>
  );
}

// ---- Main Composition ----

export const VideoComments: React.FC<VideoCommentsProps> = ({
  videoFile,
  commentFile,
  subtitleFiles,
}) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [subtitles, setSubtitles] = useState<SubtitleCue[]>([]);
  const [handle] = useState(() => delayRender("Loading data"));

  useEffect(() => {
    let pending = 2;

    const tryContinue = () => {
      pending--;
      if (pending <= 0) continueRender(handle);
    };

    // Load comments
    if (commentFile) {
      fetch(staticFile(commentFile))
        .then((r) => r.json())
        .then((data: CommentsData) => {
          const allComments = data.comments || [];
          const roots = allComments.filter((c) => c.parent === "root");
          const replies = allComments.filter((c) => c.parent !== "root");

          const grouped = roots.map((root) => ({
            ...root,
            replies: replies.filter((r) => r.parent === root.id),
          }));

          const sorted = [...grouped].sort((a, b) => {
            if (a.is_pinned && !b.is_pinned) return -1;
            if (!a.is_pinned && b.is_pinned) return 1;
            return (b.like_count || 0) - (a.like_count || 0);
          });

          setComments(sorted);
          tryContinue();
        })
        .catch((err) => {
          console.error("Failed to load comments:", err);
          tryContinue();
        });
    } else {
      tryContinue();
    }

    // Load subtitles
    if (subtitleFiles.length > 0) {
      fetch(staticFile(subtitleFiles[0]))
        .then((r) => r.text())
        .then((vttText) => {
          setSubtitles(parseVTT(vttText));
          tryContinue();
        })
        .catch((err) => {
          console.error("Failed to load subtitles:", err);
          tryContinue();
        });
    } else {
      tryContinue();
    }
  }, [commentFile, subtitleFiles, handle]);

  const { durationInFrames, fps } = useVideoConfig();
  const videoSeconds = durationInFrames / fps;
  const maxComments = Math.floor(videoSeconds / 2);

  const selectedComments = useMemo(
    () => comments.slice(0, maxComments),
    [comments, maxComments],
  );

  const videoSrc = videoFile ? staticFile(videoFile) : "";

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Top section: Video */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 620,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#000",
          overflow: "hidden",
        }}
      >
        {videoSrc && (
          <OffthreadVideo
            src={videoSrc}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />
        )}
        {/* Subtitles overlaid on video */}
        <SubtitleOverlay cues={subtitles} />
      </div>

      {/* Bottom section: Scrolling comments */}
      <div
        style={{
          position: "absolute",
          top: 640,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "#000",
          overflow: "hidden",
        }}
      >
        <CommentsList comments={selectedComments} />
      </div>
    </AbsoluteFill>
  );
};
