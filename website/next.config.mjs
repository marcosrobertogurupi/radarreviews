/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Proxy transparente: /admin/* → app admin no Vercel
      // Mantém a URL como www.reputei.com.br/admin sem redirecionar
      {
        source: '/admin',
        destination: 'https://admin-henna-two-20.vercel.app/admin',
      },
      {
        source: '/admin/:path*',
        destination: 'https://admin-henna-two-20.vercel.app/admin/:path*',
      },
    ]
  },
}

export default nextConfig
