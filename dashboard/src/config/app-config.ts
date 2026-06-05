import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Revideo",
  version: packageJson.version,
  copyright: `© ${currentYear}, Revideo.`,
  meta: {
    title: "Revideo 控制台",
    description: "用于下载、翻译、渲染、发布和浏览器自动化的工作流控制台。",
  },
};
