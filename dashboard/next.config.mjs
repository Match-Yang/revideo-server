/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

const nextConfig = {
  // Static export only for production builds; dev server runs normally with hot reload
  ...(!isDev && { output: "export" }),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  turbopack: {},
  reactCompiler: true,
  compiler: {
    removeConsole: !isDev,
  },
  // In dev, proxy /api/* to the main backend server so hot reload works end-to-end
  ...(isDev && {
    async rewrites() {
      const port = process.env.REVIDEO_PORT ?? "3001";
      return [
        { source: "/api/:path*", destination: `http://localhost:${port}/api/:path*` },
      ];
    },
  }),
};

export default nextConfig;
