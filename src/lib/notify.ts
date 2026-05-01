import { sendWhatsAppMessage } from '../services/whatsapp/uazapi.js'

const CHANNEL_HINTS: Record<string, string> = {
  google_maps:    'Google Maps — informe o Place ID (ChIJ...)',
  tripadvisor:    'TripAdvisor — confirme o url_path (/Restaurant_Reviews-...)',
  facebook:       'Facebook — página conectada via OAuth, verifique se está correta',
  instagram:      'Instagram — conta conectada via OAuth, verifique se está correta',
  trustpilot:     'Trustpilot — informe o slug da empresa',
  reclame_aqui:   'Reclame Aqui — informe o slug da empresa',
  consumidor_gov: 'Consumidor.gov — informe a URL do CSV',
}

export async function notifyAdminChannels(data: {
  businessName: string
  channels: string[]
  email?: string
  plan?: string
  title?: string
}): Promise<void> {
  const adminPhone  = process.env['ADMIN_PHONE']
  const uazapiToken = process.env['UAZAPI_TOKEN']

  if (!adminPhone || !uazapiToken) {
    console.log('[admin-notify] ADMIN_PHONE ou UAZAPI_TOKEN não configurados — pulando.')
    return
  }

  const channelList = data.channels
    .map(ch => `• ${CHANNEL_HINTS[ch] ?? ch}`)
    .join('\n')

  const title = data.title ?? '🔔 *Novo assinante cadastrado!*'
  let message = `${title}\n\n🏢 Empresa: *${data.businessName}*\n`
  if (data.email) message += `📧 E-mail: ${data.email}\n`
  if (data.plan)  message += `💼 Plano: ${data.plan}\n`
  message += `\n⚠️ *${data.channels.length} canal(is) para verificar:*\n${channelList}\n\nAcesse o painel admin → Conectores.`

  const baseUrl = process.env['UAZAPI_BASE_URL'] ?? 'https://api.uazapi.com'
  const result = await sendWhatsAppMessage({ baseUrl, token: uazapiToken, number: adminPhone, text: message })
  if (result.success) {
    console.log(`[admin-notify] Notificação enviada para ${adminPhone}`)
  } else {
    console.warn('[admin-notify] Falha ao enviar WhatsApp:', result.error)
  }
}
