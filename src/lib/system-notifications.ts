import axios from 'axios'
import { supabase } from './supabase.js'
import { logger } from './logger.js'
import type { ChannelConnector } from '../types/connector.js'

/**
 * Tipos de notificação do sistema
 */
export type SystemNotificationType = 
  | 'auth_failure'    // Falha de autenticação/token
  | 'sync_error'      // Erro persistente de sincronização
  | 'recovery_success' // Recuperação automática bem-sucedida

/**
 * Serviço de notificações para saúde do sistema (Health Checks).
 * Gerencia o "sininho" do Admin e disparos para N8N (WhatsApp/Email).
 */
export const systemNotifications = {
  /**
   * Registra uma falha crítica e notifica via canais externos.
   * @param delayHours Se informado, indica que o erro já persiste por X horas.
   */
  async notifyError(connector: ChannelConnector, error: string, isAuth = false, delayHours?: number) {
    const type: SystemNotificationType = isAuth ? 'auth_failure' : 'sync_error'
    
    logger.error(`[system-notifications] Notificando erro no canal ${connector.channel}`, {
      connector_id: connector.id,
      error,
      isAuth,
      delayHours
    })

    // 1. Salvar no banco para o "sininho" do Admin
    const { error: dbError } = await supabase
      .from('system_notifications')
      .insert({
        tenant_id: connector.tenant_id,
        business_id: connector.business_id,
        connector_id: connector.id,
        channel: connector.channel,
        type,
        message: error,
        status: 'pendente',
        payload: {
          error_count: connector.error_count + 1,
          first_error_at: connector.first_error_at ?? new Date().toISOString()
        }
      })

    if (dbError) {
      logger.error('[system-notifications] Falha ao salvar notificação no banco', { error: dbError.message })
    }

    // 2. Disparar para N8N (se configurado)
    await this.fireExternalAlert(connector, 'FALHA', error, isAuth, delayHours)
  },

  /**
   * Registra que um canal que estava em erro foi recuperado automaticamente.
   */
  async notifyRecovery(connector: ChannelConnector) {
    logger.info(`[system-notifications] Notificando recuperação do canal ${connector.channel}`, {
      connector_id: connector.id
    })

    // 1. Marcar notificações anteriores como "Resolvido"
    await supabase
      .from('system_notifications')
      .update({ 
        status: 'resolvido', 
        resolved_at: new Date().toISOString() 
      })
      .eq('connector_id', connector.id)
      .eq('status', 'pendente')

    // 2. Criar evento de sucesso
    await supabase.from('system_notifications').insert({
      tenant_id: connector.tenant_id,
      business_id: connector.business_id,
      connector_id: connector.id,
      channel: connector.channel,
      type: 'recovery_success',
      message: 'O canal foi reativado automaticamente após auto-recuperação.',
      status: 'resolvido',
      resolved_at: new Date().toISOString()
    })

    // 3. Disparar para N8N (opcional, mas bom para histórico)
    await this.fireExternalAlert(connector, 'RESOLVIDO', 'Canal recuperado e operando normalmente.', false)
  },

  /**
   * Envia o alerta para o webhook do N8N para disparo de WhatsApp/Email.
   */
  async fireExternalAlert(connector: ChannelConnector, status: 'FALHA' | 'RESOLVIDO', message: string, isAuth: boolean, delayHours?: number) {
    const webhookUrl = process.env['N8N_SYSTEM_ALERTS_WEBHOOK'] || process.env['N8N_WEBHOOK_URL']
    
    if (!webhookUrl) {
      logger.debug('[system-notifications] Webhook de alertas não configurado. Pulando alerta externo.')
      return
    }

    // Buscar contatos do Admin e nome da empresa em paralelo
    const [settingsRes, bizRes] = await Promise.all([
      supabase
        .from('system_settings')
        .select('admin_whatsapp, admin_email')
        .eq('id', 'global')
        .single(),
      supabase
        .from('monitored_businesses')
        .select('name')
        .eq('id', connector.business_id)
        .single()
    ])

    const settings = settingsRes.data
    const businessName = bizRes.data?.name || 'Desconhecido'

    // Mensagem rica alinhada com o fluxo de escalonamento
    let formatted_message = '';
    if (status === 'FALHA') {
      if (delayHours) {
        formatted_message = `⚠️ *ALERTA DE SAÚDE DO SISTEMA*\n\n🚨 *Falha Crítica (${delayHours}h sem solução):* O canal *${connector.channel.toUpperCase()}* da empresa *${businessName}* está fora do ar há mais de ${delayHours} horas e requer intervenção.\n\n*Último Erro:* ${message}\n\nFavor verificar as credenciais ou logs de sincronização no painel admin.`;
      } else {
        formatted_message = `⚠️ *ALERTA DE SAÚDE DO SISTEMA*\n\n🚨 *Falha Crítica:* O canal *${connector.channel.toUpperCase()}* da empresa *${businessName}* apresentou uma falha inesperada.\n\n*Erro:* ${message}\n\nFavor verificar as credenciais ou logs de sincronização no painel admin.`;
      }
    } else {
      formatted_message = `✅ *ALERTA DE SAÚDE DO SISTEMA*\n\n👍 *Auto-Recuperação:* O canal *${connector.channel.toUpperCase()}* da empresa *${businessName}* voltou a operar normalmente.`;
    }

    const payload = {
      event: 'system_health_alert',
      status,
      channel: connector.channel,
      business_id: connector.business_id,
      business_name: businessName, // Adicionado para o workflow do n8n
      connector_id: connector.id,
      message,
      is_auth_error: isAuth,
      delay_hours: delayHours,
      timestamp: new Date().toISOString(),
      admin_url: `https://reputei-admin.vercel.app/connectors/${connector.id}`,
      // Contatos para o n8n saber para quem disparar
      admin_whatsapp: settings?.admin_whatsapp || '',
      admin_email: settings?.admin_email || '',
      formatted_message // Adicionado para manter consistência total com server.ts
    }

    try {
      await axios.post(webhookUrl, payload, { timeout: 5000 })
      logger.info('[system-notifications] Alerta externo enviado para N8N com sucesso.')
    } catch (err) {
      logger.warn('[system-notifications] Falha ao enviar alerta para N8N', {
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
}
