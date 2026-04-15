'use client'

import React, { useEffect, useState } from 'react'
import Navbar from '../components/Navbar'
import { 
  ShieldCheck, MessageSquare, TrendingUp, Search, 
  MapPin, Radio, LayoutDashboard, Instagram, 
  Facebook, AlertCircle, Sparkles, MessageCircle
} from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      <Navbar />

      {/* ── Hero Section ──────────────────────────────── */}
      <section className="relative pt-40 pb-32 px-4 overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[600px] pointer-events-none opacity-20 bg-radial-gradient from-indigo-500/20 via-transparent to-transparent blur-3xl" />
        <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 rounded-full bg-indigo-900/10 blur-[120px] pointer-events-none translate-z-0" />
        
        <div className="max-w-7xl mx-auto relative z-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm font-semibold mb-8 animate-fade-in">
            <Sparkles size={14} />
            <span>Monitoramento Automático com IA</span>
          </div>
          
          <h1 className="text-6xl md:text-8xl font-black font-outfit mb-8 tracking-tighter leading-[0.95] animate-float">
            Sua reputação sendo monitorada <br />
            <span className="gradient-text italic">24hrs por dia.</span>
          </h1>
          
          <p className="max-w-2xl mx-auto text-xl text-gray-400 mb-12 leading-relaxed">
            O SaaS brasileiro que protege sua marca. Centralize Google Maps, Reclame Aqui, Consumidor.gov e redes sociais em uma inteligência única.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link 
              href="https://radarreviews-spnb.vercel.app" 
              className="px-8 py-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xl font-bold transition-all shadow-2xl shadow-indigo-500/40 transform hover:-translate-y-1"
            >
              Assine Reputei
            </Link>
            <Link 
              href="#canais" 
              className="px-8 py-5 bg-gray-900 hover:bg-gray-800 text-white rounded-2xl text-xl font-semibold transition-all border border-gray-800"
            >
              Ver Canais Monitorados
            </Link>
          </div>

          <div className="mt-20 pt-10 border-t border-gray-900 grid grid-cols-2 md:grid-cols-4 gap-8 opacity-50 grayscale hover:grayscale-0 transition-all duration-700">
             <div className="flex items-center justify-center gap-2"><MapPin size={20} /> <span className="font-bold">Google Maps</span></div>
             <div className="flex items-center justify-center gap-2"><AlertCircle size={20} /> <span className="font-bold">Reclame Aqui</span></div>
             <div className="flex items-center justify-center gap-2"><MessageSquare size={20} /> <span className="font-bold">TripAdvisor</span></div>
             <div className="flex items-center justify-center gap-2"><Radio size={20} /> <span className="font-bold">Reddit</span></div>
          </div>
        </div>
      </section>

      {/* ── Dashboard Snippet ──────────────────────────── */}
      <section className="px-4 py-20 relative">
        <div className="max-w-6xl mx-auto">
          <div className="relative p-1 bg-gradient-to-br from-indigo-500/50 via-gray-800 to-gray-900 rounded-[2rem] shadow-3xl">
             <div className="bg-gray-950 rounded-[1.8rem] overflow-hidden border border-white/5 aspect-video flex flex-col items-center justify-center p-10 text-center">
                 <LayoutDashboard size={64} className="text-indigo-500 mb-6 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
                 <h2 className="text-3xl font-black mb-4 font-outfit">Tudo em uma única tela.</h2>
                 <p className="text-gray-400 max-w-md">Análise de sentimento baseada no Google Gemini 2.0 que entende sarcasmo, gírias e a urgência de cada reclamação.</p>
             </div>
          </div>
        </div>
      </section>

      {/* ── Canais Monitorados ─────────────────────────── */}
      <section id="canais" className="py-32 px-4 bg-gray-950">
        <div className="max-w-7xl mx-auto text-center mb-20">
           <h2 className="text-4xl md:text-5xl font-black font-outfit mb-6">Pronto para qualquer plataforma</h2>
           <p className="text-gray-400 max-w-2xl mx-auto">Não importa onde o seu cliente reclame, nós capturamos e notificamos sua equipe em tempo real.</p>
        </div>

        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
           {[
             { title: 'Plataformas de Review', icon: Search, desc: 'Google Maps, TripAdvisor e Trustpilot.' },
             { title: 'Canais Oficiais', icon: ShieldCheck, desc: 'Reclame Aqui e Consumidor.gov.br (Min. Justiça).' },
             { title: 'Redes Sociais', icon: TrendingUp, desc: 'Instagram, Facebook e menções no Reddit.' }
           ].map((card, i) => (
             <div key={i} className="p-8 bg-gray-900/50 border border-gray-800 rounded-3xl hover:border-indigo-500/50 transition-all group">
                <card.icon className="text-indigo-500 mb-6 group-hover:scale-110 transition-transform" size={40} />
                <h3 className="text-xl font-bold mb-3">{card.title}</h3>
                <p className="text-gray-400 leading-relaxed">{card.desc}</p>
             </div>
           ))}
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────── */}
      <footer className="pt-20 pb-10 px-4 border-t border-gray-900">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-10 text-center md:text-left">
           <div>
              <div className="flex items-center gap-3 mb-4 justify-center md:justify-start">
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                  <Radio size={16} className="text-white" />
                </div>
                <span className="text-xl font-black tracking-tight font-outfit">Reputei</span>
              </div>
              <p className="text-gray-500 text-sm max-w-xs">A plataforma líder em proteção de reputação online para empresas brasileiras.</p>
           </div>
           <div className="flex gap-10 text-sm font-medium text-gray-400">
              <Link href="/" className="hover:text-white">Home</Link>
              <Link href="/parceiros" className="hover:text-white">Parceiros</Link>
              <Link href="https://radarreviews-spnb.vercel.app" className="hover:text-white text-indigo-400">Login Cliente</Link>
           </div>
           <div className="text-gray-500 text-sm">
              &copy; 2026 Reputei SaaS. Todos os direitos reservados.
           </div>
        </div>
      </footer>

      {/* ── Floating WhatsApp Button ─────────────────── */}
      <a 
        href="https://wa.me/5500000000000?text=Olá! Gostaria de saber mais sobre o Reputei." 
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-8 right-8 z-[60] bg-green-500 hover:bg-green-600 text-white p-4 rounded-full shadow-2xl shadow-green-500/40 transition-all transform hover:scale-110 flex items-center gap-2 group"
      >
        <MessageCircle size={24} />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-500 font-bold whitespace-nowrap">
          Falar com um consultor
        </span>
      </a>
    </div>
  )
}
