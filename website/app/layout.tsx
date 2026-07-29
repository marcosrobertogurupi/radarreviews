import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Reputei — Monitoramento de Reputação Online para PMEs',
  description:
    'SaaS brasileiro que monitora Google Maps, Facebook, Instagram, Reclame Aqui, Consumidor.gov, TripAdvisor, Trustpilot e Reddit em um único dashboard.',
  other: {
    'trustpilot-one-time-domain-verification-id': 'a3a8180d-73d8-45c6-bf09-7032c856e214',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="scroll-smooth">
      <head>
        <meta name="trustpilot-one-time-domain-verification-id" content="a3a8180d-73d8-45c6-bf09-7032c856e214" />
      </head>
      <body className="bg-gray-950 text-white antialiased font-sans selection:bg-indigo-500/30">
        {children}
      </body>
    </html>
  )
}
