import nodemailer from 'nodemailer'
import { logger } from '../lib/logger.js'

export class EmailService {
  private transporter: nodemailer.Transporter | null = null
  private fromAddress: string = 'Reputei <suporte@reputei.com.br>'

  constructor() {
    const host = process.env['SMTP_HOST']
    const port = parseInt(process.env['SMTP_PORT'] || '587', 10)
    const user = process.env['SMTP_USER']
    const pass = process.env['SMTP_PASS']
    const secure = process.env['SMTP_SECURE'] === 'true'
    const from = process.env['SMTP_FROM']

    if (from) {
      this.fromAddress = from
    }

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass }
      })
      logger.info('Serviço de e-mail SMTP inicializado com sucesso', { host, port, secure })
    } else {
      logger.warn('SMTP não configurado. Os e-mails serão registrados apenas nos logs.')
    }
  }

  /**
   * Envia um e-mail genérico com layout padrão
   */
  async sendEmail(to: string, subject: string, htmlContent: string, textContent?: string): Promise<boolean> {
    const defaultHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #030712; color: #f3f4f6; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 40px auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
          .header { text-align: center; border-bottom: 1px solid #1f2937; padding: 30px 20px; background: linear-gradient(135deg, #1e1b4b, #111827); }
          .logo { color: #6366f1; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.05em; }
          .subtitle { color: #9ca3af; font-size: 13px; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 0.1em; }
          .content { padding: 30px 40px; line-height: 1.6; font-size: 15px; color: #e5e7eb; }
          .footer { text-align: center; border-top: 1px solid #1f2937; padding: 20px; background-color: #0b0f19; font-size: 11px; color: #6b7280; }
          .btn { display: inline-block; padding: 12px 24px; margin: 20px 0; font-weight: 600; color: #ffffff !important; background: linear-gradient(135deg, #6366f1, #4f46e5); text-decoration: none; border-radius: 8px; font-size: 14px; text-align: center; }
          .stars { color: #f59e0b; font-size: 18px; margin: 4px 0; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; background-color: #1f2937; color: #9ca3af; }
          .badge-critical { background-color: rgba(239, 68, 68, 0.15); color: #ef4444; }
          .badge-negative { background-color: rgba(245, 158, 11, 0.15); color: #f59e0b; }
          .card { background-color: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 14px; color: #d1d5db; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="logo">Reputei</h1>
            <p class="subtitle">Inteligência de Reputação Online</p>
          </div>
          <div class="content">
            ${htmlContent}
          </div>
          <div class="footer">
            <p style="margin: 0;">Este é um e-mail transacional do Reputei SaaS.</p>
            <p style="margin: 5px 0 0 0;">© 2026 Reputei. Todos os direitos reservados.</p>
          </div>
        </div>
      </body>
      </html>
    `

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.fromAddress,
          to,
          subject,
          html: defaultHtml,
          text: textContent || subject
        })
        logger.info('E-mail enviado via SMTP com sucesso', { to, subject })
        return true
      } catch (err: any) {
        logger.error('Falha ao enviar e-mail via SMTP', { to, subject, error: err.message })
        return false
      }
    } else {
      logger.info('[Email Service - Simulação de Envio]', {
        to,
        subject,
        textContent: textContent || 'Sem conteúdo texto alternativo'
      })
      return true
    }
  }

  /**
   * Envia e-mail de alerta de review crítico para o assinante
   */
  async sendReviewAlertEmail(to: string, review: any, ruleName: string): Promise<boolean> {
    const channelLabel = (review.channel as string || '').toUpperCase().replace('_', ' ')
    const ratingStars = review.rating ? '★'.repeat(Math.round(Number(review.rating))) + '☆'.repeat(5 - Math.round(Number(review.rating))) : 'Sem nota'
    const isCritical = review.sentiment === 'critical' || review.sentiment === 'negative'
    const badgeClass = isCritical ? 'badge-critical' : 'badge-negative'
    const sentimentLabel = (review.sentiment as string || '').toUpperCase()

    const html = `
      <h2 style="margin-top: 0; color: #ffffff;">🚨 Nova avaliação crítica detectada!</h2>
      <p>Olá,</p>
      <p>Sua regra de alerta <strong>"${ruleName}"</strong> foi disparada por uma nova avaliação recebida.</p>
      
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
          <div>
            <strong style="color: #ffffff; font-size: 15px;">Canal: ${channelLabel}</strong>
            <div class="stars">${ratingStars}</div>
          </div>
          <span class="badge ${badgeClass}">${sentimentLabel}</span>
        </div>
        
        <p style="margin: 8px 0; font-style: italic; color: #e5e7eb;">"${review.body || review.body_preview || '(Sem conteúdo em texto)'}"</p>
        <p style="margin: 8px 0 0 0; font-size: 12px; color: #9ca3af;">Autor: ${review.author_name || review.author || 'Anônimo'}</p>
      </div>

      ${review.sentiment_summary ? `
        <h4 style="margin: 16px 0 8px 0; color: #ffffff;">🧠 Resumo do Sentimento (IA)</h4>
        <p style="font-size: 14px; margin: 0 0 16px 0;">${review.sentiment_summary}</p>
      ` : ''}

      ${review.dissatisfaction_score ? `
        <p style="font-size: 14px;">🔥 <strong>Nível de Insatisfação:</strong> ${review.dissatisfaction_score}/100</p>
      ` : ''}

      <div style="text-align: center; margin-top: 30px;">
        <a href="${process.env['VITE_PORTAL_URL'] || 'http://localhost:5173'}/reviews" class="btn">Visualizar no Portal</a>
      </div>
    `

    return this.sendEmail(
      to,
      `[Alerta Reputei] Nova avaliação crítica no ${channelLabel}`,
      html,
      `Alerta Reputei: Nova avaliação crítica no ${channelLabel} (${review.rating} estrelas) por ${review.author_name || 'Anônimo'}.`
    )
  }

  /**
   * Envia e-mail de confirmação de abertura de chamado de suporte
   */
  async sendTicketCreatedEmail(to: string, ticket: any): Promise<boolean> {
    const priorityLabel = (ticket.priority as string || '').toUpperCase()
    const html = `
      <h2 style="margin-top: 0; color: #ffffff;">🎫 Chamado de Suporte Aberto</h2>
      <p>Olá,</p>
      <p>Confirmamos que a sua solicitação de suporte foi aberta com sucesso e já está em nossa fila de atendimento.</p>
      
      <div class="card">
        <strong style="color: #ffffff; font-size: 16px; display: block; margin-bottom: 8px;">#${ticket.ticket_number} - ${ticket.subject}</strong>
        <p style="margin: 8px 0; color: #9ca3af; font-size: 13px;">Prioridade: <span style="font-weight: 700; color: ${ticket.priority === 'critical' ? '#ef4444' : 'var(--text-primary)'}">${priorityLabel}</span></p>
        <div style="border-top: 1px solid #374151; padding-top: 12px; margin-top: 12px; white-space: pre-wrap; font-size: 13px; color: #e5e7eb;">${ticket.description}</div>
      </div>

      <p style="font-size: 14px; color: #9ca3af;">O prazo de resposta para a sua solicitação é baseado no plano de sua assinatura e prioridade do chamado.</p>

      <div style="text-align: center; margin-top: 30px;">
        <a href="${process.env['VITE_PORTAL_URL'] || 'http://localhost:5173'}/support" class="btn">Acompanhar Chamado</a>
      </div>
    `

    return this.sendEmail(
      to,
      `[Suporte Reputei] Chamado #${ticket.ticket_number} aberto com sucesso`,
      html,
      `Seu chamado #${ticket.ticket_number} "${ticket.subject}" foi criado com sucesso no Reputei.`
    )
  }

  /**
   * Envia e-mail de notificação de nova resposta em chamado
   */
  async sendTicketReplyEmail(to: string, ticket: any, replyBody: string, authorName: string): Promise<boolean> {
    const html = `
      <h2 style="margin-top: 0; color: #ffffff;">💬 Nova resposta no Chamado #${ticket.ticket_number}</h2>
      <p>Olá,</p>
      <p>Você recebeu uma nova mensagem no seu chamado de suporte:</p>
      
      <div class="card" style="border-left: 4px solid #6366f1;">
        <div style="font-size: 12px; color: #9ca3af; margin-bottom: 6px; font-weight: 600;">
          Enviada por: ${authorName}
        </div>
        <div style="white-space: pre-wrap; color: #e5e7eb; font-size: 14px; line-height: 1.5;">${replyBody}</div>
      </div>

      <p style="font-size: 14px; color: #9ca3af;">Para responder a esta mensagem, por favor, clique no botão abaixo para acessar o portal de suporte.</p>

      <div style="text-align: center; margin-top: 30px;">
        <a href="${process.env['VITE_PORTAL_URL'] || 'http://localhost:5173'}/support" class="btn">Responder no Portal</a>
      </div>
    `

    return this.sendEmail(
      to,
      `[Suporte Reputei] Nova resposta no chamado #${ticket.ticket_number}`,
      html,
      `Nova resposta de ${authorName} no chamado #${ticket.ticket_number}: ${replyBody}`
    )
  }
}

export const emailService = new EmailService()
