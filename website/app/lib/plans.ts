export interface Plan {
  id: string
  slug: string
  name: string
  description?: string
  price_monthly: number
  max_channels: number
  color?: string
  is_popular?: boolean
  is_active?: boolean
  is_public?: boolean
  benefits?: string[]
}

export interface CalculatedPlanOption {
  key: string
  planSlug: string
  planName: string
  periodKey: 'mensal' | 'trimestral' | 'semestral' | 'anual'
  periodLabel: string
  months: number
  discount: number
  total: number
  monthly: number
  displayName: string
}

export const FALLBACK_PLANS: Plan[] = [
  {
    id: '1', slug: 'basico', name: 'Básico',
    description: 'Para pequenos negócios locais.', price_monthly: 289,
    max_channels: 3, color: '#10b981', is_popular: false,
    benefits: ['3 canais monitorados','500 reviews/mês','Google Maps & TripAdvisor','Alertas por e-mail','Relatórios semanais','Suporte por e-mail'],
  },
  {
    id: '2', slug: 'completo', name: 'Completo',
    description: 'Monitoramento total + IA.', price_monthly: 459,
    max_channels: 8, color: '#6366f1', is_popular: true,
    benefits: ['8 canais monitorados','Reviews ilimitados','Todos os canais disponíveis','IA Copilot incluso','Alertas via WhatsApp/SMS','Suporte prioritário'],
  },
  {
    id: '3', slug: 'custom', name: 'Custom',
    description: 'Flexibilidade para sua marca.', price_monthly: 389,
    max_channels: 5, color: '#f59e0b', is_popular: false,
    benefits: ['Canais sob demanda','Reviews ilimitados','IA Copilot incluso','Relatórios personalizados','Multi-unidades','Gerente de conta'],
  },
  {
    id: '4', slug: 'enterprise', name: 'Enterprise',
    description: 'Escala e performance máxima.', price_monthly: 1500,
    max_channels: 999, color: '#ef4444', is_popular: false,
    benefits: ['Canais ilimitados','SLA garantido','Integrações via API/Webhooks','Suporte 24/7 dedicado','Consultoria trimestral','Desconto por volume'],
  },
]

export const PERIOD_OPTIONS = [
  { key: 'mensal',     label: 'Mensal',     months: 1,  discount: 0  },
  { key: 'trimestral', label: 'Trimestral', months: 3,  discount: 5  },
  { key: 'semestral',  label: 'Semestral',  months: 6,  discount: 10 },
  { key: 'anual',      label: 'Anual',      discount: 20, months: 12 },
] as const

export async function fetchPublicPlans(): Promise<Plan[]> {
  const CACHE_KEY = 'reputei_plans_cache'

  // 1. Tenta API Backend (Railway)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api-production-24e1.up.railway.app'
  try {
    const res = await fetch(`${apiUrl}/api/plans`)
    if (res.ok) {
      const data: Plan[] = await res.json()
      const filtered = data.filter(p => p.slug !== 'trial' && Number(p.price_monthly) > 0)
      if (filtered.length > 0) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(filtered)) } catch {}
        return filtered
      }
    }
  } catch {}

  // 2. Tenta Supabase REST direto caso a API backend não responda
  try {
    const supabaseUrl = 'https://lkwahbipteiqqzkmfrac.supabase.co'
    const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxrd2FoYmlwdGVpcXF6a21mcmFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MTM4MjcsImV4cCI6MjA5MTQ4OTgyN30.tTEK34V1G1aIPDggdzv2lPx07eOOE2_umrRLoXErN6U'
    const res = await fetch(`${supabaseUrl}/rest/v1/plans?is_active=eq.true&is_public=eq.true&select=*,plan_benefits(id,description,sort_order)&order=sort_order.asc`, {
      headers: { apikey: anonKey }
    })
    if (res.ok) {
      const rawData = await res.json()
      const data: Plan[] = (rawData ?? []).map((p: any) => ({
        id: p.id,
        slug: p.slug,
        name: p.name === 'Basico' ? 'Básico' : p.name,
        description: p.description,
        price_monthly: Number(p.price_monthly) || 0,
        max_channels: p.max_channels,
        color: p.color,
        is_popular: p.is_popular,
        benefits: (p.plan_benefits ?? [])
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((b: any) => b.description),
      }))
      const filtered = data.filter(p => p.slug !== 'trial' && p.price_monthly > 0)
      if (filtered.length > 0) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(filtered)) } catch {}
        return filtered
      }
    }
  } catch {}

  // 3. Tenta cache local do navegador
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {}

  // 4. Fallback padrão
  return FALLBACK_PLANS
}

export function buildPlanOptions(rawPlans: Plan[]): CalculatedPlanOption[] {
  const options: CalculatedPlanOption[] = []
  const validPlans = (rawPlans || []).filter(p => p.slug !== 'trial' && Number(p.price_monthly) > 0)

  for (const plan of validPlans) {
    const basePrice = Number(plan.price_monthly) || 0
    const displayNameBase = plan.name === 'Basico' ? 'Básico' : plan.name

    for (const period of PERIOD_OPTIONS) {
      const mult = 1 - period.discount / 100
      const monthly = +(basePrice * mult).toFixed(2)
      const total = +(monthly * period.months).toFixed(2)
      const key = `${plan.slug}_${period.key}`
      const totalFmt = Math.round(total).toLocaleString('pt-BR')
      const displayName = `${displayNameBase} — ${period.label} — R$ ${totalFmt}`

      options.push({
        key,
        planSlug: plan.slug,
        planName: displayNameBase,
        periodKey: period.key as 'mensal' | 'trimestral' | 'semestral' | 'anual',
        periodLabel: period.label,
        months: period.months,
        discount: period.discount,
        total,
        monthly,
        displayName,
      })
    }
  }

  return options.length > 0 ? options : buildPlanOptions(FALLBACK_PLANS)
}
