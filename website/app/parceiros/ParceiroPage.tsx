'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Building2, UserCircle2, Briefcase, Check, X, ChevronDown,
  TrendingUp, Download, Star, Shield, ArrowRight, FileText,
  Video, MessageSquare, BookOpen, Zap, Globe, Phone, Mail,
  Users, Award, BarChart3, Lock, Clock, RefreshCw, Sparkles,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────

type TipoKey  = 'agencia' | 'consultor' | 'representante'
type PlanKey  = 'basic_tri' | 'basic_sem' | 'basic_ano' | 'complete_tri' | 'complete_sem' | 'complete_ano'

// ── Data ─────────────────────────────────────────────────────────

const PLANS: Record<PlanKey, { nome: string; total: number; monthly: number }> = {
  basic_tri:    { nome: 'Basic — Trimestral',    total: 357,   monthly: 119    },
  basic_sem:    { nome: 'Basic — Semestral',     total: 642,   monthly: 107    },
  basic_ano:    { nome: 'Basic — Anual',         total: 1142,  monthly: 95.17  },
  complete_tri: { nome: 'Complete — Trimestral', total: 717,   monthly: 239    },
  complete_sem: { nome: 'Complete — Semestral',  total: 1290,  monthly: 215    },
  complete_ano: { nome: 'Complete — Anual',      total: 2292,  monthly: 191    },
}

const COMMISSIONS: Record<TipoKey, { entrada: number; recorrente: number }> = {
  agencia:       { entrada: 20, recorrente: 10 },
  consultor:     { entrada: 25, recorrente: 12 },
  representante: { entrada: 30, recorrente: 0  },
}

const PARTNER_TYPES = [
  {
    id: 'agencia' as TipoKey,
    icon: Building2,
    nome: 'Agência Parceira',
    popular: true,
    perfil: 'Agências de marketing digital, social media e SEO com carteira de clientes PMEs.',
    entrada: '20%',
    recorrente: '10% / mês',
    recorrenteLabel: 'Recorrente mensal',
    cor: 'indigo',
  },
  {
    id: 'consultor' as TipoKey,
    icon: UserCircle2,
    nome: 'Consultor Independente',
    popular: false,
    perfil: 'Consultores e coaches com carteira própria de clientes fiéis.',
    entrada: '25%',
    recorrente: '12% / mês',
    recorrenteLabel: 'Recorrente mensal',
    cor: 'cyan',
  },
  {
    id: 'representante' as TipoKey,
    icon: Briefcase,
    nome: 'Representante Comercial',
    popular: false,
    perfil: 'Vendedores B2B com foco em prospecção ativa por região ou segmento.',
    entrada: '30%',
    recorrente: 'Comissão única',
    recorrenteLabel: 'Sem recorrência',
    cor: 'violet',
  },
]

const LEVELS = [
  {
    id: 'silver',
    nome: 'Silver',
    cor: '#94A3B8',
    bg: 'rgba(148,163,184,0.08)',
    border: 'rgba(148,163,184,0.25)',
    requisito: '1 a 4 clientes ativos',
    beneficios: [
      'Acesso ao portal do parceiro',
      'Link de indicação rastreável',
      'Dashboard de comissões em tempo real',
      'Kit de materiais de vendas',
      'Conta demo do Reputei',
      'Suporte via chat (horário comercial)',
      'Treinamento de produto gravado (1h)',
      null, null,
    ],
  },
  {
    id: 'gold',
    nome: 'Gold',
    cor: '#F59E0B',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.3)',
    requisito: '5 a 15 clientes ativos',
    beneficios: [
      'Tudo do Silver',
      'White-label com marca da agência',
      'Landing page co-branded',
      'Acesso antecipado a novos recursos',
      'Webinar mensal exclusivo Gold+',
      'Suporte prioritário (SLA 4h)',
      'Certificação oficial Reputei Partner',
      null, null,
    ],
  },
  {
    id: 'platinum',
    nome: 'Platinum',
    cor: '#7C3AED',
    bg: 'rgba(124,58,237,0.1)',
    border: 'rgba(124,58,237,0.4)',
    requisito: '16+ clientes ativos',
    beneficios: [
      'Tudo do Gold',
      'CSM dedicado',
      'Campanhas de co-marketing pagas',
      'Comissão negociável acima do padrão',
      'Acesso à API para integrações',
      'Badge verificado no site Reputei',
      'Suporte 24/7 via WhatsApp exclusivo',
      'Convite para advisory board',
      null,
    ],
  },
]

const HOW_STEPS = [
  { icon: FileText,     title: 'Cadastre-se',        desc: 'Preencha o formulário de inscrição. Análise em até 48h.' },
  { icon: BookOpen,     title: 'Certifique-se',       desc: 'Conclua o treinamento (1h gravado) e passe no quiz de certificação.' },
  { icon: Zap,          title: 'Receba seu link',     desc: 'Link único e rastreável para todas as suas indicações.' },
  { icon: Users,        title: 'Indique clientes',    desc: 'Compartilhe com sua carteira — o cliente faz o trial de 7 dias.' },
  { icon: TrendingUp,   title: 'Receba comissões',    desc: 'Pagamento todo dia 10 do mês via PIX. Acompanhe no dashboard.' },
]

const KIT_ITEMS = [
  { icon: FileText,     title: 'Pitch Deck',          desc: 'Apresentação pronta para mostrar aos clientes.' },
  { icon: Download,     title: 'One-Pager PDF',        desc: 'Resumo do produto em uma página, para enviar por e-mail.' },
  { icon: MessageSquare,title: 'FAQ de Vendas',        desc: 'Respostas prontas para as principais objeções.' },
  { icon: Phone,        title: 'Scripts de Abordagem', desc: 'Templates de WhatsApp e e-mail para prospecção.' },
  { icon: Globe,        title: 'Conta Demo',           desc: 'Acesso ao Reputei com dados reais para demonstrações ao vivo.' },
  { icon: Video,        title: 'Vídeos de Demo',       desc: 'Screencast dos principais recursos do produto.' },
]

const RULES = [
  {
    icon: Shield,
    title: 'Atribuição permanente do primeiro parceiro',
    desc: 'O primeiro parceiro que indicar um cliente fica com a atribuição permanente. Se o cliente cancelar e reativar em até 12 meses, a atribuição é mantida.',
  },
  {
    icon: RefreshCw,
    title: 'Clawback em cancelamento antes de 90 dias',
    desc: 'Se um cliente cancelar em menos de 90 dias, a comissão de entrada é descontada da próxima comissão do parceiro.',
  },
  {
    icon: Users,
    title: 'Mesmo preço para todos os canais',
    desc: 'O cliente paga o mesmo preço independentemente de ter vindo pelo site ou por um parceiro. A comissão sai da margem do Reputei.',
  },
  {
    icon: TrendingUp,
    title: 'Pagamento mínimo de R$ 50 para saque',
    desc: 'Comissões são pagas até o dia 10 do mês seguinte via PIX ou TED. Abaixo de R$ 50, acumula para o próximo ciclo.',
  },
  {
    icon: Clock,
    title: 'Trial de 7 dias não gera comissão',
    desc: 'A comissão de entrada é calculada sobre o primeiro pagamento real, após o período de teste.',
  },
  {
    icon: Lock,
    title: 'Certificação obrigatória para ativar o link',
    desc: 'Treinamento de produto (1h) + quiz com nota mínima 7 de 10. Parceiros não certificados não podem usar o link de indicação.',
  },
]

const FAQS = [
  {
    q: 'Posso oferecer o Reputei com white-label para meus clientes?',
    a: 'Sim, mas apenas no nível Gold (5+ clientes ativos). No white-label, a plataforma aparece com a marca da sua agência.',
  },
  {
    q: 'Existe exclusividade de território?',
    a: 'Não há exclusividade de território. Qualquer parceiro pode vender para qualquer cliente no Brasil. A atribuição é pelo primeiro link de indicação.',
  },
  {
    q: 'Posso indicar concorrentes diretos dos meus clientes?',
    a: 'Sim. O Reputei não restringe a quem você pode indicar. Sua estratégia comercial é sua.',
  },
  {
    q: 'O que acontece se meu cliente cancelar?',
    a: 'Você deixa de receber a recorrência a partir do mês seguinte ao cancelamento. Se o cancelamento ocorrer em menos de 90 dias, a comissão de entrada é descontada da sua próxima comissão.',
  },
  {
    q: 'Há um número mínimo de vendas para continuar no programa?',
    a: 'Não há mínimo obrigatório, mas parceiros sem nenhuma indicação em 6 meses podem ter o acesso ao portal revisado.',
  },
  {
    q: 'Como funciona a comissão no plano anual?',
    a: 'A comissão de entrada (20–30%) é calculada sobre o valor total pago. A recorrência mensal (10–12%) é calculada sobre o valor mensal equivalente (total anual ÷ 12).',
  },
]

// ── Helpers ───────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })
}

function calculate(tipo: TipoKey, planKey: PlanKey, cpm: number) {
  const plan = PLANS[planKey]
  const comm = COMMISSIONS[tipo]

  if (tipo === 'representante') {
    const mes = Math.round(comm.entrada / 100 * plan.total * cpm)
    return { mes1: mes, recorrenteMensal: 0, totalAno: mes * 12 }
  }

  let totalAno = 0
  let acumulados = 0
  let mes1 = 0

  for (let m = 1; m <= 12; m++) {
    acumulados += cpm
    const entrada    = comm.entrada    / 100 * plan.total   * cpm
    const recorrente = comm.recorrente / 100 * plan.monthly * acumulados
    const mesTotal   = entrada + recorrente
    if (m === 1) mes1 = mesTotal
    totalAno += mesTotal
  }

  const recorrenteFinal = Math.round(comm.recorrente / 100 * plan.monthly * (cpm * 12))
  return { mes1: Math.round(mes1), recorrenteMensal: recorrenteFinal, totalAno: Math.round(totalAno) }
}

// ── useInView ─────────────────────────────────────────────────────

function useInView() {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(true) },
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return { ref, visible }
}

// ── Components ────────────────────────────────────────────────────

function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const { ref, visible } = useInView()
  return (
    <div ref={ref} className={`section-fade ${visible ? 'visible' : ''} ${className}`}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 text-indigo-400 text-sm font-semibold mb-4 tracking-wide uppercase">
      {children}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────

export default function ParceiroPage() {
  const [tipo,    setTipo]    = useState<TipoKey>('agencia')
  const [planKey, setPlanKey] = useState<PlanKey>('complete_tri')
  const [clientes, setClientes] = useState(5)
  const [openRule, setOpenRule] = useState<number | null>(null)
  const [openFaq,  setOpenFaq]  = useState<number | null>(null)
  const [formSent, setFormSent] = useState(false)
  const [formLoading, setFormLoading] = useState(false)
  const [formError,   setFormError]   = useState('')
  const [form, setForm] = useState({
    nome: '', email: '', whatsapp: '', tipo_parceiro: '', empresa: '',
    carteira: '', cidade: '', como_conheceu: '', mensagem: '', termos: false,
  })

  const result = calculate(tipo, planKey, clientes)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nome || !form.email || !form.whatsapp || !form.tipo_parceiro) {
      setFormError('Preencha todos os campos obrigatórios (*).')
      return
    }
    if (!form.termos) {
      setFormError('Você precisa aceitar os termos do programa.')
      return
    }
    setFormError('')
    setFormLoading(true)
    setTimeout(() => {
      setFormLoading(false)
      setFormSent(true)
      console.log('[parceiros] form:', form)
    }, 1500)
  }

  const inputCls = 'w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 transition-colors'
  const labelCls = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2'

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">

      {/* ══════════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════════ */}
      <section
        id="hero"
        className="relative overflow-hidden pt-24 pb-20 px-4"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.18) 0%, transparent 70%), #030712' }}
      >
        {/* Decorative orbs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 text-indigo-400 text-sm font-semibold mb-8">
            <Sparkles size={14} /> Reputei Partner Program
          </div>

          <h1 className="font-display font-black text-5xl sm:text-6xl lg:text-7xl leading-[1.05] mb-6">
            <span className="gradient-text">Venda reputação.<br />Ganhe recorrência.</span>
          </h1>

          <p className="text-gray-300 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Indique o Reputei para seus clientes e receba <strong className="text-white">comissão na entrada + mensalmente</strong> enquanto o cliente permanecer ativo.
          </p>

          {/* Metrics */}
          <div className="flex flex-wrap justify-center gap-4 mb-12">
            {[
              { value: 'Até 30%', label: 'comissão na 1ª venda' },
              { value: '10–12%', label: 'recorrente todo mês' },
              { value: '3 tipos', label: 'de parceria disponíveis' },
            ].map(m => (
              <div key={m.value} className="bg-gray-900/60 border border-gray-800 rounded-2xl px-6 py-4 backdrop-blur-sm">
                <div className="font-display font-black text-3xl text-white">{m.value}</div>
                <div className="text-gray-400 text-sm mt-1">{m.label}</div>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href="#cadastro"
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-4 rounded-xl transition-all shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:-translate-y-0.5"
            >
              Quero ser parceiro <ArrowRight size={18} />
            </a>
            <a
              href="#como-funciona"
              className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold px-8 py-4 rounded-xl transition-all border border-gray-700"
            >
              Ver como funciona
            </a>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          TIPOS DE PARCERIA
      ══════════════════════════════════════════════════════════ */}
      <section id="tipos" className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <Section className="text-center mb-14">
            <SectionLabel><Building2 size={14} /> Tipos de parceria</SectionLabel>
            <h2 className="font-display font-bold text-4xl text-white mb-4">Escolha como quer parceirar</h2>
            <p className="text-gray-400 text-lg max-w-xl mx-auto">Três modelos de parceria com comissões diferentes, pensados para perfis distintos.</p>
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PARTNER_TYPES.map(pt => {
              const Icon = pt.icon
              const colorMap: Record<string, string> = {
                indigo: 'border-indigo-500/40 bg-indigo-500/5',
                cyan:   'border-cyan-500/30 bg-cyan-500/5',
                violet: 'border-violet-500/30 bg-violet-500/5',
              }
              const badgeMap: Record<string, string> = {
                indigo: 'text-indigo-400',
                cyan:   'text-cyan-400',
                violet: 'text-violet-400',
              }
              const iconBgMap: Record<string, string> = {
                indigo: 'bg-indigo-500/15 text-indigo-400',
                cyan:   'bg-cyan-500/15 text-cyan-400',
                violet: 'bg-violet-500/15 text-violet-400',
              }
              return (
                <Section key={pt.id}>
                  <div className={`relative h-full rounded-2xl border p-7 flex flex-col gap-5 transition-all hover:-translate-y-1 hover:shadow-xl ${colorMap[pt.cor]}`}>
                    {pt.popular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap shadow-lg shadow-indigo-500/30">
                        Mais popular
                      </div>
                    )}
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${iconBgMap[pt.cor]}`}>
                      <Icon size={22} />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-xl text-white mb-2">{pt.nome}</h3>
                      <p className="text-gray-400 text-sm leading-relaxed">{pt.perfil}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 py-4 border-t border-gray-800">
                      <div>
                        <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Comissão entrada</div>
                        <div className={`font-display font-black text-2xl ${badgeMap[pt.cor]}`}>{pt.entrada}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{pt.recorrenteLabel}</div>
                        <div className={`font-display font-black text-2xl ${badgeMap[pt.cor]}`}>{pt.recorrente}</div>
                      </div>
                    </div>
                    <a href="#cadastro" className="mt-auto inline-flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold px-5 py-3 rounded-xl border border-gray-700 transition-all">
                      Quero me cadastrar <ArrowRight size={14} />
                    </a>
                  </div>
                </Section>
              )
            })}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          NÍVEIS
      ══════════════════════════════════════════════════════════ */}
      <section id="niveis" className="py-20 px-4 bg-gray-900/30">
        <div className="max-w-6xl mx-auto">
          <Section className="text-center mb-14">
            <SectionLabel><Award size={14} /> Níveis do programa</SectionLabel>
            <h2 className="font-display font-bold text-4xl text-white mb-4">Cresça e desbloqueie mais benefícios</h2>
            <p className="text-gray-400 text-lg max-w-xl mx-auto">Quanto mais clientes ativos você traz, mais benefícios exclusivos você acessa.</p>
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {LEVELS.map(lv => (
              <Section key={lv.id}>
                <div
                  className="h-full rounded-2xl border p-7 flex flex-col gap-5"
                  style={{ background: lv.bg, borderColor: lv.border }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: lv.bg, border: `1px solid ${lv.border}` }}>
                      <Star size={18} style={{ color: lv.cor }} />
                    </div>
                    <div>
                      <div className="font-display font-black text-2xl" style={{ color: lv.cor }}>{lv.nome}</div>
                      <div className="text-xs text-gray-400">{lv.requisito}</div>
                    </div>
                  </div>
                  <ul className="flex flex-col gap-3">
                    {lv.beneficios.map((b, i) => (
                      b ? (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-gray-300">
                          <Check size={14} className="mt-0.5 flex-shrink-0" style={{ color: lv.cor }} />
                          {b}
                        </li>
                      ) : (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-gray-600">
                          <X size={14} className="mt-0.5 flex-shrink-0" />
                          <span className="line-through">Não disponível</span>
                        </li>
                      )
                    ))}
                  </ul>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          SIMULADOR DE GANHOS
      ══════════════════════════════════════════════════════════ */}
      <section id="simulador" className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <Section className="text-center mb-14">
            <SectionLabel><BarChart3 size={14} /> Simulador de ganhos</SectionLabel>
            <h2 className="font-display font-bold text-4xl text-white mb-4">Quanto você pode ganhar?</h2>
            <p className="text-gray-400 text-lg max-w-xl mx-auto">Ajuste os parâmetros e veja sua projeção de ganhos em tempo real.</p>
          </Section>

          <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-8 backdrop-blur-sm">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">

              {/* Controls */}
              <div className="flex flex-col gap-7">
                {/* Tipo */}
                <div>
                  <div className={labelCls}>Tipo de parceiro</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['agencia', 'consultor', 'representante'] as TipoKey[]).map(t => (
                      <button
                        key={t}
                        onClick={() => setTipo(t)}
                        className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all ${
                          tipo === t
                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                        }`}
                      >
                        {t === 'agencia' ? 'Agência' : t === 'consultor' ? 'Consultor' : 'Representante'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Plano */}
                <div>
                  <div className={labelCls}>Plano que pretende vender</div>
                  <select
                    value={planKey}
                    onChange={e => setPlanKey(e.target.value as PlanKey)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                  >
                    {(Object.entries(PLANS) as [PlanKey, { nome: string; total: number }][]).map(([k, v]) => (
                      <option key={k} value={k}>{v.nome} — {fmt(v.total)}</option>
                    ))}
                  </select>
                </div>

                {/* Clientes por mês */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <div className={labelCls}>Clientes por mês</div>
                    <div className="font-display font-black text-2xl text-indigo-400">{clientes}</div>
                  </div>
                  <input
                    type="range"
                    min={1} max={50}
                    value={clientes}
                    onChange={e => setClientes(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>1</span><span>50</span>
                  </div>
                </div>

                {/* Info das comissões */}
                <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700 text-sm">
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-400">Comissão de entrada</span>
                    <span className="text-white font-semibold">{COMMISSIONS[tipo].entrada}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Recorrência mensal</span>
                    <span className="text-white font-semibold">
                      {tipo === 'representante' ? '— (comissão única)' : `${COMMISSIONS[tipo].recorrente}%`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Results */}
              <div className="flex flex-col gap-5 justify-center">
                <div className="bg-indigo-950/60 border border-indigo-500/20 rounded-2xl p-6 text-center">
                  <div className="text-indigo-300 text-sm font-semibold uppercase tracking-wider mb-2">Ganho no 1º mês</div>
                  <div className="font-display font-black text-5xl text-white mb-1">{fmt(result.mes1)}</div>
                  <div className="text-indigo-300/60 text-xs">entrada + 1ª recorrência</div>
                </div>

                {tipo !== 'representante' && (
                  <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 text-center">
                    <div className="text-gray-400 text-sm font-semibold uppercase tracking-wider mb-2">Recorrência mensal (mês 12)</div>
                    <div className="font-display font-black text-3xl text-cyan-400">{fmt(result.recorrenteMensal)}</div>
                    <div className="text-gray-500 text-xs mt-1">base de {clientes * 12} clientes acumulados</div>
                  </div>
                )}

                <div className="bg-gradient-to-br from-indigo-900/40 to-violet-900/40 border border-indigo-500/30 rounded-2xl p-6 text-center">
                  <div className="text-indigo-300 text-sm font-semibold uppercase tracking-wider mb-2">Total em 12 meses</div>
                  <div className="font-display font-black text-5xl text-white mb-1">{fmt(result.totalAno)}</div>
                  <div className="text-indigo-300/60 text-xs">projeção acumulada no ano</div>
                </div>

                <p className="text-xs text-gray-500 text-center leading-relaxed">
                  * Projeção estimada. Valores reais dependem de conversão e retenção dos clientes indicados.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          COMO FUNCIONA
      ══════════════════════════════════════════════════════════ */}
      <section id="como-funciona" className="py-20 px-4 bg-gray-900/30">
        <div className="max-w-4xl mx-auto">
          <Section className="text-center mb-14">
            <SectionLabel><Zap size={14} /> Passo a passo</SectionLabel>
            <h2 className="font-display font-bold text-4xl text-white mb-4">Como funciona</h2>
            <p className="text-gray-400 text-lg max-w-xl mx-auto">Do cadastro ao primeiro pagamento em 5 passos simples.</p>
          </Section>

          <div className="flex flex-col gap-0">
            {HOW_STEPS.map((step, i) => {
              const Icon = step.icon
              return (
                <Section key={i}>
                  <div className="flex gap-6 pb-8 relative">
                    {/* Line */}
                    {i < HOW_STEPS.length - 1 && (
                      <div className="absolute left-6 top-14 bottom-0 w-px bg-gradient-to-b from-indigo-500/40 to-transparent" />
                    )}
                    {/* Number circle */}
                    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-indigo-600 border-2 border-indigo-400/30 flex items-center justify-center shadow-lg shadow-indigo-500/20 relative z-10">
                      <Icon size={20} className="text-white" />
                    </div>
                    <div className="pt-2.5">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-xs text-indigo-400 font-bold uppercase tracking-widest">Passo {i + 1}</span>
                      </div>
                      <h3 className="font-display font-bold text-xl text-white mb-1">{step.title}</h3>
                      <p className="text-gray-400 text-sm leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                </Section>
              )
            })}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          KIT DO PARCEIRO
      ══════════════════════════════════════════════════════════ */}
      <section id="kit" className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <Section className="text-center mb-14">
            <SectionLabel><Download size={14} /> Kit do parceiro</SectionLabel>
            <h2 className="font-display font-bold text-4xl text-white mb-4">Tudo pronto para você vender</h2>
            <p className="text-gray-400 text-lg max-w-xl mx-auto">Materiais prontos, desbloqueados após a certificação.</p>
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {KIT_ITEMS.map((item, i) => {
              const Icon = item.icon
              return (
                <Section key={i}>
                  <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-6 flex gap-4 items-start hover:border-indigo-500/30 hover:bg-gray-900/80 transition-all group">
                    <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-500/20 transition-colors">
                      <Icon size={18} className="text-indigo-400" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white mb-1">{item.title}</h4>
                      <p className="text-gray-400 text-sm leading-relaxed">{item.desc}</p>
                      <span className="inline-flex items-center gap-1 text-xs text-indigo-400/60 mt-2">
                        <Lock size={10} /> Disponível após cadastro
                      </span>
                    </div>
                  </div>
                </Section>
              )
            })}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          REGRAS
      ══════════════════════════════════════════════════════════ */}
      <section id="regras" className="py-20 px-4 bg-gray-900/30">
        <div className="max-w-3xl mx-auto">
          <Section className="text-center mb-14">
            <SectionLabel><Shield size={14} /> Regras do programa</SectionLabel>
            <h2 className="font-display font-bold text-4xl text-white mb-4">Transparência total</h2>
            <p className="text-gray-400 text-lg max-w-xl mx-auto">Conheça as regras antes de se cadastrar. Sem letras miúdas.</p>
          </Section>

          <div className="flex flex-col gap-3">
            {RULES.map((rule, i) => {
              const Icon = rule.icon
              const open = openRule === i
              return (
                <Section key={i}>
                  <div className={`bg-gray-900/60 border rounded-xl overflow-hidden transition-all ${open ? 'border-indigo-500/30' : 'border-gray-800 hover:border-gray-700'}`}>
                    <button
                      className="w-full flex items-center gap-4 p-5 text-left"
                      onClick={() => setOpenRule(open ? null : i)}
                    >
                      <div className="w-9 h-9 bg-indigo-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Icon size={16} className="text-indigo-400" />
                      </div>
                      <span className="font-semibold text-white flex-1 text-sm">{rule.title}</span>
                      <ChevronDown size={16} className={`text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="px-5 pb-5 pt-0">
                        <div className="pl-[52px] text-gray-400 text-sm leading-relaxed">{rule.desc}</div>
                      </div>
                    )}
                  </div>
                </Section>
              )
            })}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          FAQ
      ══════════════════════════════════════════════════════════ */}
      <section id="faq" className="py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <Section className="text-center mb-14">
            <SectionLabel><MessageSquare size={14} /> Dúvidas frequentes</SectionLabel>
            <h2 className="font-display font-bold text-4xl text-white mb-4">Perguntas frequentes</h2>
          </Section>

          <div className="flex flex-col gap-3">
            {FAQS.map((faq, i) => {
              const open = openFaq === i
              return (
                <Section key={i}>
                  <div className={`border rounded-xl overflow-hidden transition-all ${open ? 'bg-gray-900/80 border-indigo-500/30' : 'bg-gray-900/40 border-gray-800 hover:border-gray-700'}`}>
                    <button
                      className="w-full flex items-center justify-between gap-4 p-5 text-left"
                      onClick={() => setOpenFaq(open ? null : i)}
                    >
                      <span className="font-semibold text-white text-sm">{faq.q}</span>
                      <ChevronDown size={16} className={`text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="px-5 pb-5 text-gray-400 text-sm leading-relaxed">{faq.a}</div>
                    )}
                  </div>
                </Section>
              )
            })}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          FORMULÁRIO DE CADASTRO
      ══════════════════════════════════════════════════════════ */}
      <section id="cadastro" className="py-20 px-4 bg-gray-900/30">
        <div className="max-w-2xl mx-auto">
          <Section className="text-center mb-12">
            <SectionLabel><Mail size={14} /> Cadastro</SectionLabel>
            <h2 className="font-display font-bold text-4xl text-white mb-4">Comece agora mesmo</h2>
            <p className="text-gray-400 text-lg max-w-xl mx-auto">Preencha o formulário e aguarde o contato em até 48 horas.</p>
          </Section>

          {formSent ? (
            <Section>
              <div className="text-center py-16 px-8 bg-gray-900/60 border border-gray-800 rounded-2xl">
                <div className="w-20 h-20 bg-green-500/15 border-2 border-green-500/30 rounded-full flex items-center justify-center mx-auto mb-6" style={{ animation: 'pop-in 0.4s ease' }}>
                  <Check size={36} className="text-green-400" />
                </div>
                <h3 className="font-display font-bold text-2xl text-white mb-3">Cadastro recebido!</h3>
                <p className="text-gray-400 leading-relaxed max-w-sm mx-auto">
                  Analisaremos sua inscrição em até <strong className="text-white">48 horas</strong> e você receberá um e-mail com os próximos passos.
                </p>
              </div>
            </Section>
          ) : (
            <Section>
              <form onSubmit={handleSubmit} className="bg-gray-900/60 border border-gray-800 rounded-2xl p-8 flex flex-col gap-6">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className={labelCls}>Nome completo *</label>
                    <input type="text" className={inputCls} placeholder="Seu nome"
                      value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>E-mail profissional *</label>
                    <input type="email" className={inputCls} placeholder="seu@email.com"
                      value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>WhatsApp *</label>
                    <input type="tel" className={inputCls} placeholder="(00) 90000-0000"
                      value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Tipo de parceiro *</label>
                    <select className={inputCls + ' cursor-pointer'}
                      value={form.tipo_parceiro} onChange={e => setForm(f => ({ ...f, tipo_parceiro: e.target.value }))}>
                      <option value="">Selecione...</option>
                      <option value="agencia">Agência Parceira</option>
                      <option value="consultor">Consultor Independente</option>
                      <option value="representante">Representante Comercial</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Nome da empresa / negócio</label>
                    <input type="text" className={inputCls} placeholder="Sua agência ou empresa"
                      value={form.empresa} onChange={e => setForm(f => ({ ...f, empresa: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Carteira estimada de clientes</label>
                    <select className={inputCls + ' cursor-pointer'}
                      value={form.carteira} onChange={e => setForm(f => ({ ...f, carteira: e.target.value }))}>
                      <option value="">Selecione...</option>
                      <option value="1-10">1 a 10 clientes</option>
                      <option value="11-30">11 a 30 clientes</option>
                      <option value="31-100">31 a 100 clientes</option>
                      <option value="100+">Mais de 100 clientes</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Cidade e estado</label>
                    <input type="text" className={inputCls} placeholder="Ex: São Paulo — SP"
                      value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Como conheceu o programa?</label>
                    <select className={inputCls + ' cursor-pointer'}
                      value={form.como_conheceu} onChange={e => setForm(f => ({ ...f, como_conheceu: e.target.value }))}>
                      <option value="">Selecione...</option>
                      <option value="google">Google</option>
                      <option value="indicacao">Indicação</option>
                      <option value="redes">Redes sociais</option>
                      <option value="outro">Outro</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Mensagem (opcional)</label>
                  <textarea rows={3} className={inputCls + ' resize-none'} placeholder="Conte um pouco sobre sua carteira ou expectativas..."
                    value={form.mensagem} onChange={e => setForm(f => ({ ...f, mensagem: e.target.value }))} />
                </div>

                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 accent-indigo-500 flex-shrink-0 cursor-pointer"
                    checked={form.termos}
                    onChange={e => setForm(f => ({ ...f, termos: e.target.checked }))}
                  />
                  <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                    Li e aceito os termos do Programa de Parceiros Reputei, incluindo as regras de comissão, clawback e certificação obrigatória.
                  </span>
                </label>

                {formError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                    {formError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={formLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                >
                  {formLoading ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" /> Enviando...
                    </>
                  ) : (
                    <>Enviar candidatura <ArrowRight size={16} /></>
                  )}
                </button>
              </form>
            </Section>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════════════ */}
      <footer className="border-t border-gray-800 py-10 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-sm">📡</div>
            <span className="font-display font-bold text-white">Reputei</span>
          </div>
          <p className="text-gray-500 text-sm text-center">
            © {new Date().getFullYear()} Reputei. Todos os direitos reservados. ·
            <a href="#" className="text-gray-400 hover:text-white ml-1 transition-colors">Termos</a> ·
            <a href="#" className="text-gray-400 hover:text-white ml-1 transition-colors">Privacidade</a>
          </p>
        </div>
      </footer>

      <style>{`
        @keyframes pop-in { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        select option { background-color: #111827; color: white; }
      `}</style>
    </div>
  )
}
