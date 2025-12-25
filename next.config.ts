import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OCR pipeline uses native modules / worker threads that should not be bundled.
  serverExternalPackages: ["@napi-rs/canvas", "tesseract.js", "pdfjs-dist"],
};

export default nextConfig;
