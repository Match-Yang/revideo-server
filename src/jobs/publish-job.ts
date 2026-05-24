import type { RevideoJob, TargetPlatform } from "./types";
import { resolvePublisher } from "../platforms/publishers/registry";

export async function preflightJobTarget(job: RevideoJob, platform: TargetPlatform) {
  const publisher = resolvePublisher(platform);
  if (!publisher) {
    return { ok: false, message: `${platform} publisher not found` };
  }
  if (!publisher.implemented) {
    return { ok: false, message: `${platform} publisher is planned but not implemented` };
  }
  return publisher.preflight(job);
}

export async function publishJobTarget(job: RevideoJob, platform: TargetPlatform, force?: boolean) {
  const publisher = resolvePublisher(platform);
  if (!publisher) {
    throw new Error(`${platform} publisher not found`);
  }
  if (!publisher.implemented) {
    throw new Error(`${platform} publisher is planned but not implemented`);
  }
  return publisher.publish(job, force);
}
