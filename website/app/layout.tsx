import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Reputei — Monitoramento de Reputação Online para PMEs',
  description:
    'SaaS brasileiro que monitora Google Maps, Facebook, Instagram, Reclame Aqui, Consumidor.gov, TripAdvisor, Trustpilot e Reddit em um único dashboard.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-gray-950 text-white antialiased font-sans">{children}</body>
    </html>
  )
}
