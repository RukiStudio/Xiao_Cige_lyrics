/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // Electron 打包用：产出可独立运行的 server
};

export default nextConfig;
