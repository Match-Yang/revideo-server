import "./index.css";
import { Composition, staticFile } from "remotion";
import { getVideoMetadata } from "@remotion/media-utils";
import {
  VideoComments,
  videoCommentsSchema,
} from "./Composition";
import type { VideoCommentsProps } from "./Composition";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920; // 9:16 vertical

const defaultProps: VideoCommentsProps = {
  dirPath: "",
  videoFile: "video.mp4",
  commentFile: "comments.json",
  subtitleFiles: [],
  durationInFrames: 0,
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
        calculateMetadata={async ({ props }) => {
          // If duration already set by renderer, use it
          if (props.durationInFrames && props.durationInFrames > 0) {
            return { durationInFrames: props.durationInFrames, props };
          }
          // Otherwise detect from video file in public/
          if (props.videoFile) {
            try {
              const meta = await getVideoMetadata(staticFile(props.videoFile));
              return {
                durationInFrames: Math.ceil(meta.durationInSeconds * FPS),
                props,
              };
            } catch {}
          }
          return { durationInFrames: 30 * FPS, props };
        }}
      />
    </>
  );
};
