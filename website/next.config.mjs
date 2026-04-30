/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Proxy transparente: /admin → app admin Vercel (index)
      {
        source: '/admin',
        destination: 'https://admin-henna-two-20.vercel.app/',
      },
      // Proxy para sub-rotas e assets do admin
      {
        source: '/admin/:path*',
        destination: 'https://admin-henna-two-20.vercel.app/:path*',
      },
    ]
  },
}

export default nextConfig
