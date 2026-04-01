import "./index.css";
import { Composition } from "remotion";
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
  durationInFrames: 30 * 60,
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
        calculateMetadata={({ props }) => ({
          durationInFrames: props.durationInFrames ?? 30 * 60,
          props,
        })}
      />
    </>
  );
};
