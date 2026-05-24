import fs from "fs";
import os from "os";
import path from "path";

export function resolveCommand(name: string): string {
  const candidates =
    name === "yt-dlp"
      ? [
          process.env.YT_DLP_BIN,
          path.join(os.homedir(), "Library", "Python", "3.14", "bin", "yt-dlp"),
          path.join(os.homedir(), ".local", "bin", "yt-dlp"),
          path.join(os.homedir(), "bin", "yt-dlp"),
        ]
      : [process.env[`${name.toUpperCase()}_BIN`]];

  const found = candidates.find((candidate): candidate is string =>
    Boolean(candidate && fs.existsSync(candidate))
  );
  return found || name;
}
