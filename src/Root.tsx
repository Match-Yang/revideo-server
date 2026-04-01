import "./index.css";
import { Composition, type CalculateMetadataFunction } from "remotion";
import {
  VideoComments,
  videoCommentsSchema,
} from "./Composition";
import type { VideoCommentsProps } from "./Composition";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920; // 9:16 vertical

const defaultProps: VideoCommentsProps = {
  dirPath: "/Users/auto/Movies/T7pbd7SFihU",
  videoFile: "video.mp4",
  commentFile: "comments.json",
  subtitleFiles: ["subtitles.vtt"],
};

const calculateMetadata: CalculateMetadataFunction<VideoCommentsProps> =
  async ({ props }) => {
    let durationSec = 60;

    if (props.commentFile) {
      try {
        const fs = await import("fs");
        const path = await import("path");
        const publicDir = path.join(process.cwd(), "public");
        const commentPath = path.join(publicDir, props.commentFile);
        if (fs.existsSync(commentPath)) {
          const data = JSON.parse(fs.readFileSync(commentPath, "utf-8"));
          durationSec = data.duration || 60;
        }
      } catch (e) {
        console.error("Failed to read duration:", e);
      }
    }

    return {
      durationInFrames: Math.ceil(durationSec * FPS),
      props,
    };
  };

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VideoComments"
        component={VideoComments}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        schema={videoCommentsSchema}
        defaultProps={defaultProps}
        calculateMetadata={calculateMetadata}
      />
    </>
  );
};
