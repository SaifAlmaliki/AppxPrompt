import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Dev only: lets the app be opened through an ngrok tunnel (see JOBS_PUBLIC_URL).
  allowedDevOrigins: ["*.ngrok-free.app"],
};

export default nextConfig;
