/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // ── Admin Panel ───────────────────────────────────────────
      // /admin → admin app (index.html com base='/admin')
      // /admin/assets/* → assets do admin app
      {
        source: '/admin',
        destination: 'https://admin-henna-two-20.vercel.app/',
      },
      {
        source: '/admin/:path*',
        destination: 'https://admin-henna-two-20.vercel.app/:path*',
      },

      // ── Portal do Cliente ─────────────────────────────────────
      // /portalcliente → portal app (index.html com base='/portalcliente')
      // /portalcliente/assets/* → assets do portal app
      {
        source: '/portalcliente',
        destination: 'https://radarreviews-spnb.vercel.app/',
      },
      {
        source: '/portalcliente/:path*',
        destination: 'https://radarreviews-spnb.vercel.app/:path*',
      },
    ]
  },
}

export default nextConfig
