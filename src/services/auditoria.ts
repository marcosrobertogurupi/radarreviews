import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

export interface AuditEntry {
  usuario_id?: string
  usuario_nome: string
  usuario_email: string
  usuario_perfil: string
  operacao: string
  descricao: string
  entidade_tipo?: string
  entidade_id?: string
  ip_origem?: string
}

export class AuditoriaService {
  static async registrar(entry: AuditEntry) {
    try {
      const { error } = await supabaseAdmin
        .from('auditoria')
        .insert([{
          ...entry,
          data_hora: new Date().toISOString()
        }])
      
      if (error) {
        console.error('[auditoria] Erro ao gravar log:', error.message)
      }
    } catch (err) {
      console.error('[auditoria] Erro fatal:', err)
    }
  }

  /**
   * Helper para registrar ações de admin/operador
   */
  static async registrarAcaoAdmin(
    user: { id: string; nome: string; email: string; perfil: string },
    operacao: string,
    descricao: string,
    ip?: string,
    entidade?: { tipo: string; id: string }
  ) {
    return this.registrar({
      usuario_id: user.id,
      usuario_nome: user.nome,
      usuario_email: user.email,
      usuario_perfil: user.perfil,
      operacao,
      descricao,
      ip_origem: ip,
      entidade_tipo: entidade?.tipo,
      entidade_id: entidade?.id
    })
  }
}
