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
          let durationInFrames = props.durationInFrames || 0;
          let isPortrait = props.isPortrait ?? false;
          let videoAspectRatio = props.videoAspectRatio ?? 16 / 9;

          if (props.videoFile) {
            try {
              const meta = await getVideoMetadata(staticFile(props.videoFile));
              if (meta.width && meta.height) {
                isPortrait = meta.height > meta.width;
                videoAspectRatio = meta.width / meta.height;
              }
              if (!durationInFrames || durationInFrames <= 0) {
                durationInFrames = Math.ceil(meta.durationInSeconds * FPS);
              }
            } catch {}
          }

          if (!durationInFrames || durationInFrames <= 0) {
            durationInFrames = 30 * FPS;
          }

          return {
            durationInFrames,
            width: WIDTH,
            height: HEIGHT,
            props: {
              ...props,
              isPortrait,
              videoAspectRatio,
            },
          };
        }}
      />
    </>
  );
};
