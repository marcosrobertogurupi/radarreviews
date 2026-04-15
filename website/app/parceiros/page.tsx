import type { Metadata } from 'next'
import ParceiroPage from './ParceiroPage'

export const metadata: Metadata = {
  title: 'Programa de Parceiros — Reputei',
  description:
    'Venda reputação. Ganhe recorrência. Torne-se um parceiro Reputei e ganhe até 30% de comissão na primeira venda mais recorrência mensal enquanto o cliente permanecer ativo.',
  openGraph: {
    title: 'Programa de Parceiros — Reputei',
    description: 'Até 30% de comissão na entrada + 10–12% recorrente todo mês. 3 tipos de parceria disponíveis.',
    type: 'website',
    locale: 'pt_BR',
  },
}

export default function Page() {
  return <ParceiroPage />
}
