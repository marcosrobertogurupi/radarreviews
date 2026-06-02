import axios from 'axios';
import 'dotenv/config';

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
if (!ASAAS_API_KEY) {
  console.warn('[Asaas] ASAAS_API_KEY não configurada. Operações de pagamento irão falhar.');
}
const ASAAS_API_URL = process.env.ASAAS_API_URL || 'https://www.asaas.com/api/v3';

const asaas = axios.create({
  baseURL: ASAAS_API_URL,
  headers: {
    'access_token': ASAAS_API_KEY || '',
    'Content-Type': 'application/json'
  }
});

export interface AsaasCustomer {
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone?: string;
}

export interface AsaasSubscription {
  customerId: string;
  billingType: 'PIX' | 'CREDIT_CARD';
  value: number;
  nextDueDate: string; // YYYY-MM-DD
  cycle: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'ANNUALLY';
  description: string;
  externalReference?: string;
}

/**
 * Cria um cliente no Asaas
 */
export async function createAsaasCustomer(data: AsaasCustomer) {
  try {
    const response = await asaas.post('/customers', data);
    return response.data;
  } catch (error: any) {
    console.error('[Asaas] Erro ao criar cliente:', error.response?.data || error.message);
    throw new Error(error.response?.data?.errors?.[0]?.description || 'Erro ao criar cliente no Asaas');
  }
}

/**
 * Cria uma assinatura (recorrência) com Trial
 */
export async function createAsaasSubscription(data: AsaasSubscription) {
  try {
    // Para implementar o Trial, definimos a data do primeiro vencimento para daqui a 7 dias
    const response = await asaas.post('/subscriptions', {
      customer: data.customerId,
      billingType: data.billingType,
      value: data.value,
      nextDueDate: data.nextDueDate,
      cycle: data.cycle,
      description: data.description,
      externalReference: data.externalReference,
      // PIX Automático ou Cartão tokenizado
      fine: { value: 1.00 }, // Multa por atraso
      interest: { value: 1.00 } // Juros por atraso
    });
    
    return response.data;
  } catch (error: any) {
    console.error('[Asaas] Erro ao criar assinatura:', error.response?.data || error.message);
    throw new Error(error.response?.data?.errors?.[0]?.description || 'Erro ao criar assinatura no Asaas');
  }
}


/**
 * Busca detalhes de uma assinatura no Asaas
 */
export async function getAsaasSubscription(subscriptionId: string) {
  try {
    const response = await asaas.get(`/subscriptions/${subscriptionId}`);
    return response.data;
  } catch (error: any) {
    console.error('[Asaas] Erro ao buscar assinatura:', error.response?.data || error.message);
    return null;
  }
}


/**
 * Busca cobranças (payments) de uma assinatura
 */
export async function getAsaasSubscriptionPayments(subscriptionId: string) {
  try {
    const response = await asaas.get(`/subscriptions/${subscriptionId}/payments`);
    return response.data;
  } catch (error: any) {
    console.error('[Asaas] Erro ao buscar cobranças:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Busca o QR Code PIX de uma cobrança específica
 */
export async function getAsaasPixQrCode(paymentId: string) {
  try {
    const response = await asaas.get(`/payments/${paymentId}/pixQrCode`);
    return response.data; // { encodedImage, payload, expirationDate }
  } catch (error: any) {
    console.error('[Asaas] Erro ao gerar QR Code PIX:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Busca a URL da fatura (invoice) de uma cobrança
 */
export async function getAsaasInvoiceUrl(paymentId: string) {
  try {
    const response = await asaas.get(`/payments/${paymentId}/invoiceUrl`);
    return response.data; // { invoiceUrl }
  } catch (error: any) {
    console.error('[Asaas] Erro ao buscar invoice URL:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Token de autenticação do webhook Asaas (configurado no painel Asaas)
 */
export function getAsaasWebhookToken(): string {
  return process.env.ASAAS_WEBHOOK_TOKEN || '';
}
