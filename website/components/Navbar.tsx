'use client'

import Link from 'next/link'
import { Radio } from 'lucide-react'

export default function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Radio size={24} className="text-white" />
            </div>
            <span className="text-2xl font-black tracking-tight text-white font-outfit">
              Reputei
            </span>
          </Link>

          {/* Links */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="/" className="text-gray-300 hover:text-white transition-colors">Home</Link>
            <Link href="/parceiros" className="text-gray-300 hover:text-white transition-colors">Parceiros</Link>
            <Link 
              href="/portal" 
              className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-full transition-all border border-gray-700 font-medium"
            >
              Portal do Cliente
            </Link>
            <Link 
              href="/admin" 
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-all shadow-lg shadow-indigo-500/20 font-medium"
            >
              Painel Admin
            </Link>
          </div>

          {/* Mobile Menu Placeholder (simplificado para o MVP) */}
          <div className="md:hidden flex items-center gap-4">
             <Link href="/parceiros" className="text-xs text-indigo-400 font-bold uppercase tracking-widest">Parceiros</Link>
          </div>
        </div>
      </div>
    </nav>
  )
}
