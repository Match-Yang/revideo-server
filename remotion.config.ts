/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

function webpackOverride(config: any): any {
  const next = enableTailwind(config);
  next.cache = false;
  next.snapshot = {
    ...next.snapshot,
    managedPaths: [],
    immutablePaths: [],
  };
  next.output = {
    ...next.output,
    hashFunction: "sha256",
  };
  return next;
}

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig(webpackOverride);
