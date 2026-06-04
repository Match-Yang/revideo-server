import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Revideo",
  version: packageJson.version,
  copyright: `© ${currentYear}, Revideo.`,
  meta: {
    title: "Revideo Console",
    description:
      "A workflow console for source download, translation, rendering, publishing, and browser operations.",
  },
};
