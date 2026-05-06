/**
 * Script para reativar a fila de webhook interrompida no Asaas
 * 
 * Uso: npx tsx scripts/reactivate-webhook.ts
 * 
 * Requer: ASAAS_API_KEY e ASAAS_API_URL nas variáveis de ambiente ou .env
 */

import 'dotenv/config';

const WEBHOOK_ID = 'bcef66e2-fb9e-42ce-8227-3422196089b0';
const API_KEY = process.env.ASAAS_API_KEY;
const API_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';

if (!API_KEY) {
  console.error('❌ ASAAS_API_KEY não configurada. Defina a variável de ambiente.');
  console.error('   Exemplo: set ASAAS_API_KEY=sua_chave && npx tsx scripts/reactivate-webhook.ts');
  process.exit(1);
}

async function reactivateWebhook() {
  console.log(`🔄 Reativando webhook ${WEBHOOK_ID}...`);
  console.log(`   API URL: ${API_URL}`);

  try {
    const response = await fetch(`${API_URL}/webhooks/${WEBHOOK_ID}`, {
      method: 'PUT',
      headers: {
        'access_token': API_KEY!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        interrupted: false
      })
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Webhook reativado com sucesso!');
      console.log('   Resposta:', JSON.stringify(data, null, 2));
    } else {
      console.error('❌ Erro ao reativar webhook:');
      console.error('   Status:', response.status);
      console.error('   Resposta:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('❌ Erro de conexão:', error);
  }
}

reactivateWebhook();
