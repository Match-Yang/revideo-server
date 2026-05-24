import { execFile } from "child_process";
import { resolveCommand } from "./dependencies";

export interface DependencyCheck {
  name: string;
  ok: boolean;
  version?: string;
  error?: string;
}

function checkCommand(name: string, args: string[] = ["--version"]): Promise<DependencyCheck> {
  return new Promise((resolve) => {
    execFile(resolveCommand(name), args, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          name,
          ok: false,
          error: stderr || error.message,
        });
        return;
      }
      resolve({
        name,
        ok: true,
        version: stdout.split("\n")[0],
      });
    });
  });
}

export async function getSystemHealth() {
  const dependencies = await Promise.all([
    checkCommand("yt-dlp", ["--version"]),
    checkCommand("ffmpeg", ["-version"]),
    checkCommand("ffprobe", ["-version"]),
  ]);

  return {
    ok: dependencies.every((dep) => dep.ok),
    dependencies,
  };
}
