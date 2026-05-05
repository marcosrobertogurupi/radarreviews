// Webhook handler para notificações do Asaas
// 
// Eventos processados:
//   PAYMENT_CONFIRMED / PAYMENT_RECEIVED → ativa o plano do tenant
//   PAYMENT_OVERDUE → marca como inadimplente (past_due)
//   PAYMENT_DELETED / PAYMENT_REFUNDED → suspende acesso
//   SUBSCRIPTION_DELETED → cancela assinatura
//
// O Asaas envia um POST com o payload do evento.
// Autenticação via header `asaas-access-token` comparado com ASAAS_WEBHOOK_TOKEN.

import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { getAsaasWebhookToken } from '../lib/asaas.js'

const supabaseAdmin = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

// ── Tipos do Webhook Asaas ────────────────────────────────────────

interface AsaasWebhookPayload {
  event: string
  payment?: {
    id: string
    customer: string
    subscription: string
    value: number
    status: string
    billingType: string
    invoiceUrl?: string
    externalReference?: string // tenant_id
    dueDate?: string
    paymentDate?: string
  }
  subscription?: {
    id: string
    customer: string
    status: string
    externalReference?: string // tenant_id
  }
}

// ── Mapeamento de eventos → ações ─────────────────────────────────

const PAYMENT_ACTIVATION_EVENTS = [
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
]

const PAYMENT_PROBLEM_EVENTS = [
  'PAYMENT_OVERDUE',
]

const PAYMENT_CANCEL_EVENTS = [
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
]

const SUBSCRIPTION_CANCEL_EVENTS = [
  'SUBSCRIPTION_DELETED',
  'SUBSCRIPTION_EXPIRED',
]

// ── Handler principal ─────────────────────────────────────────────

export async function handleAsaasWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // Apenas POST
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end('Method not allowed')
    return
  }

  // Ler body
  let raw = ''
  for await (const chunk of req) raw += chunk

  let payload: AsaasWebhookPayload
  try {
    payload = JSON.parse(raw)
  } catch {
    console.error('[asaas-webhook] JSON inválido recebido')
    res.writeHead(400)
    res.end('Invalid JSON')
    return
  }

  // Validar token de autenticação (opcional mas recomendado)
  const webhookToken = getAsaasWebhookToken()
  if (webhookToken) {
    const receivedToken = req.headers['asaas-access-token'] as string
    if (receivedToken !== webhookToken) {
      console.warn('[asaas-webhook] Token inválido recebido')
      res.writeHead(401)
      res.end('Unauthorized')
      return
    }
  }

  const event = payload.event
  console.log(`[asaas-webhook] Evento recebido: ${event}`, {
    paymentId: payload.payment?.id,
    subscriptionId: payload.payment?.subscription || payload.subscription?.id,
    externalRef: payload.payment?.externalReference || payload.subscription?.externalReference,
  })

  // Logar no banco para auditoria
  try {
    await supabaseAdmin.from('system_notifications').insert({
      type: 'payment',
      message: `Asaas Webhook: ${event} | Payment: ${payload.payment?.id || 'N/A'} | Subscription: ${payload.payment?.subscription || payload.subscription?.id || 'N/A'}`,
      status: 'info'
    })
  } catch (e) {
    console.error('[asaas-webhook] Erro ao logar evento:', e)
  }

  try {
    // ── Eventos de pagamento ──────────────────────────────────

    if (PAYMENT_ACTIVATION_EVENTS.includes(event) && payload.payment) {
      await handlePaymentConfirmed(payload.payment)
    }

    else if (PAYMENT_PROBLEM_EVENTS.includes(event) && payload.payment) {
      await handlePaymentOverdue(payload.payment)
    }

    else if (PAYMENT_CANCEL_EVENTS.includes(event) && payload.payment) {
      await handlePaymentCanceled(payload.payment)
    }

    // ── Eventos de assinatura ─────────────────────────────────

    else if (SUBSCRIPTION_CANCEL_EVENTS.includes(event) && payload.subscription) {
      await handleSubscriptionCanceled(payload.subscription)
    }

    else {
      console.log(`[asaas-webhook] Evento ignorado: ${event}`)
    }

    // Responder 200 para o Asaas confirmar recebimento
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[asaas-webhook] Erro ao processar evento ${event}:`, msg)
    // Retornar 200 mesmo com erro para evitar retries infinitos do Asaas
    // O erro já foi logado e pode ser investigado
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, warning: 'Processamento com erro interno' }))
  }
}

// ── Handlers por tipo de evento ───────────────────────────────────

/**
 * Pagamento confirmado → ativar plano do tenant
 */
async function handlePaymentConfirmed(payment: AsaasWebhookPayload['payment']) {
  if (!payment) return

  const tenantId = payment.externalReference
  if (!tenantId) {
    // Tentar localizar pelo asaas_subscription_id
    const tenant = await findTenantBySubscription(payment.subscription)
    if (!tenant) {
      console.warn('[asaas-webhook] Pagamento confirmado sem tenant identificável:', payment.id)
      return
    }
    await activateTenant(tenant.id, payment)
    return
  }

  await activateTenant(tenantId, payment)
}

/**
 * Pagamento em atraso → marcar como past_due
 */
async function handlePaymentOverdue(payment: AsaasWebhookPayload['payment']) {
  if (!payment) return

  const tenantId = payment.externalReference || (await findTenantBySubscription(payment.subscription))?.id
  if (!tenantId) {
    console.warn('[asaas-webhook] Pagamento overdue sem tenant:', payment.id)
    return
  }

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({
      subscription_status: 'past_due',
      plan_status: 'past_due',
    })
    .eq('id', tenantId)

  if (error) {
    console.error('[asaas-webhook] Erro ao marcar past_due:', error.message)
    return
  }

  console.log(`[asaas-webhook] Tenant ${tenantId} marcado como PAST_DUE`)

  // Notificar admin do sistema
  await supabaseAdmin.from('system_notifications').insert({
    tenant_id: tenantId,
    type: 'payment',
    message: `⚠️ Pagamento em atraso para tenant ${tenantId}. Valor: R$ ${payment.value}`,
    status: 'warning'
  })
}

/**
 * Pagamento cancelado/estornado → suspender acesso
 */
async function handlePaymentCanceled(payment: AsaasWebhookPayload['payment']) {
  if (!payment) return

  const tenantId = payment.externalReference || (await findTenantBySubscription(payment.subscription))?.id
  if (!tenantId) return

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({
      subscription_status: 'suspended',
      plan_status: 'suspended',
    })
    .eq('id', tenantId)

  if (error) {
    console.error('[asaas-webhook] Erro ao suspender tenant:', error.message)
    return
  }

  console.log(`[asaas-webhook] Tenant ${tenantId} SUSPENSO por cancelamento/estorno`)
}

/**
 * Assinatura cancelada → cancelar acesso
 */
async function handleSubscriptionCanceled(subscription: AsaasWebhookPayload['subscription']) {
  if (!subscription) return

  const tenantId = subscription.externalReference || (await findTenantBySubscription(subscription.id))?.id
  if (!tenantId) return

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({
      subscription_status: 'canceled',
      plan_status: 'canceled',
      asaas_subscription_id: null, // Limpar referência
    })
    .eq('id', tenantId)

  if (error) {
    console.error('[asaas-webhook] Erro ao cancelar tenant:', error.message)
    return
  }

  console.log(`[asaas-webhook] Tenant ${tenantId} CANCELADO`)
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Ativa o plano do tenant após pagamento confirmado
 */
async function activateTenant(tenantId: string, payment: NonNullable<AsaasWebhookPayload['payment']>) {
  const { error } = await supabaseAdmin
    .from('tenants')
    .update({
      subscription_status: 'active',
      plan_status: 'active',
      asaas_subscription_id: payment.subscription || undefined,
      billing_method: payment.billingType === 'PIX' ? 'pix' : 'credit_card',
    })
    .eq('id', tenantId)

  if (error) {
    console.error('[asaas-webhook] Erro ao ativar tenant:', error.message)
    return
  }

  console.log(`[asaas-webhook] ✅ Tenant ${tenantId} ATIVADO! Pagamento: ${payment.id}, Valor: R$ ${payment.value}`)

  // Notificar no sistema
  await supabaseAdmin.from('system_notifications').insert({
    tenant_id: tenantId,
    type: 'payment',
    message: `✅ Pagamento confirmado! Plano ativado. Valor: R$ ${payment.value} via ${payment.billingType}`,
    status: 'info'
  })
}

/**
 * Encontra o tenant pelo ID da assinatura no Asaas
 */
async function findTenantBySubscription(subscriptionId: string): Promise<{ id: string } | null> {
  if (!subscriptionId) return null

  const { data } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('asaas_subscription_id', subscriptionId)
    .single()

  return data as { id: string } | null
}
