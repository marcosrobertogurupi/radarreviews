import axios from 'axios';
import 'dotenv/config';

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_API_URL = process.env.ASAAS_API_URL || 'https://www.asaas.com/api/v3';

const asaas = axios.create({
  baseURL: ASAAS_API_URL,
  headers: {
    'access_token': ASAAS_API_KEY,
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
 * Obtém o link de pagamento da assinatura
 */
export async function getAsaasPaymentLink(subscriptionId: string) {
  try {
    const response = await asaas.get(`/subscriptions/${subscriptionId}/paymentLinks`);
    return response.data;
  } catch (error: any) {
    console.error('[Asaas] Erro ao buscar link de pagamento:', error.response?.data || error.message);
    return null;
  }
}
