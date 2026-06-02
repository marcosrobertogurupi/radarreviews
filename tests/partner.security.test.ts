import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// Usamos anon key para validar RLS
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321'
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'anon_key'
const supabase = createClient(supabaseUrl, supabaseAnonKey)

describe('Partner Module - Security & RLS', () => {

  it('deve impedir acesso não autenticado à tabela partners', async () => {
    const { data, error } = await supabase.from('partners').select('*')
    // Pode retornar array vazio dependendo do RLS, mas se estiver barrado retorna erro ou vazio
    if (error) {
      expect(error).toBeDefined()
    } else {
      expect(data).toEqual([]) // Não pode ver o parceiro dos outros
    }
  })

  it('deve impedir acesso não autenticado à tabela commissions', async () => {
    const { data, error } = await supabase.from('commissions').select('*')
    if (error) {
      expect(error).toBeDefined()
    } else {
      expect(data).toEqual([])
    }
  })

  it('a view partner_dashboard_summary não deve expor dados sem login', async () => {
    const { data, error } = await supabase.from('partner_dashboard_summary').select('*')
    if (error) {
      expect(error).toBeDefined()
    } else {
      expect(data).toEqual([])
    }
  })
})
