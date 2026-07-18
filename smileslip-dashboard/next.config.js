/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_KEY: process.env.NEXT_PUBLIC_SUPABASE_KEY,
    NEXT_PUBLIC_LIFF_ID: process.env.NEXT_PUBLIC_LIFF_ID,
  },
  // pdfkit ใช้ fs/path โดยตรง — ต้อง external ออกจาก webpack bundle
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('pdfkit');
    }
    return config;
  },
}

module.exports = nextConfig
