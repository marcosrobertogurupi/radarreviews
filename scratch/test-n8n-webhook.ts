async function testWebhook() {
  const url = 'https://webhook.netservice.net.br/webhook-test/reputei-email'
  
  console.log(`\n🔗 Testando webhook: ${url}\n`)
  
  try {
    const payload = {
      to: 'marcosroberto_gurupi@hotmail.com',
      toName: 'Marcos Roberto (Teste)',
      subject: 'Teste de Email via N8N - Reputei',
      body: 'Este é um email de teste enviado via n8n webhook. Se você recebeu, o sistema está funcionando!',
      bodyHtml: '<h2>✅ Teste N8N - Reputei</h2><p>Este é um email de teste enviado via <strong>n8n webhook</strong>.</p><p>Se você recebeu este email, o sistema de envio de prospecção está <strong>funcionando corretamente!</strong></p>',
      leadId: 'test-lead-id',
      companyName: 'Empresa Teste'
    }

    console.log('📤 Payload enviado:')
    console.log(JSON.stringify(payload, null, 2))
    console.log('\n⏳ Aguardando resposta...\n')

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    })

    console.log(`📊 Status HTTP: ${response.status}`)
    
    const text = await response.text()
    console.log(`📨 Resposta do N8N:\n${text}`)
    
    if (response.ok) {
      console.log('\n✅ SUCESSO! Webhook respondeu corretamente.')
      console.log('📧 Verifique a caixa de entrada do email: marcosroberto_gurupi@hotmail.com')
    } else {
      console.log('\n❌ ERRO: Webhook retornou erro.')
    }
  } catch (err: any) {
    console.error('\n❌ FALHA na conexão com o webhook:', err.message)
    if (err.name === 'TimeoutError') {
      console.log('⚠️  O workflow n8n pode estar inativo (não ativado).')
    }
  }
}

testWebhook()
