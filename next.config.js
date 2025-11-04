/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    esmExternals: true
  },
  output: 'standalone', // For Docker deployment
};

module.exports = nextConfig;

