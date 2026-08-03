import { GoogleGenerativeAI } from '@google/generative-ai';
import { KipflowCompanyResult, KipflowDecidorResult } from './kipflow.js';
import { logger } from './logger.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

export interface ProspectAnalysisResult {
  icp_score: number; // 0.0 a 10.0
  reputation_risk_level: 'low' | 'medium' | 'high' | 'critical';
  reputation_summary: string;
  recommended_pitch: string;
  key_selling_points: string[];
}

export class ProspectingAgent {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    if (GEMINI_API_KEY) {
      this.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    }
  }

  /**
   * Analisar perfil do prospect e gerar diagnósticos de reputação + pitch customizado
   */
  async analyzeProspect(
    company: KipflowCompanyResult,
    decidors: KipflowDecidorResult[] = []
  ): Promise<ProspectAnalysisResult> {
    try {
      logger.info('Iniciando análise inteligente de prospecção via Gemini 2.5 Flash', { companyName: company.company_name });

      if (!this.genAI) {
        return this.getFallbackAnalysis(company);
      }

      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `
Você é o Agente Especialista em Prospecção B2B do **Reputei**, um SaaS de monitoramento de reputação online e inteligência de reviews (Google Maps, Reclame Aqui, Consumidor.gov, Trustpilot, etc.).

Analise a seguinte empresa prospectada e seus decisores para determinar o alinhamento com a nossa solução (ICP Fit Score) e criar uma estratégia de abordagem altamente personalizada.

DADOS DA EMPRESA:
- Nome/Razão Social: ${company.company_name} (${company.trade_name || 'Sem nome fantasia'})
- Domínio/Site: ${company.domain || company.website || 'N/A'}
- Segmento/CNAE: ${company.cnae_description || 'N/A'}
- Porte: ${company.size || 'N/A'}
- Localização: ${company.city || 'N/A'} - ${company.state || 'N/A'}
- Faturamento Estimado: ${company.estimated_revenue || 'N/A'}

DECISORES ENCONTRADOS (${decidors.length}):
${decidors.map(d => `- ${d.name} (${d.role || 'Cargo N/A'}) - ${d.department || ''}`).join('\n')}

INSTRUÇÕES:
Retorne APENAS um JSON válido (sem texto extra, sem marcações markdown ngoài do bloco de código json) no seguinte formato:

{
  "icp_score": 8.5,
  "reputation_risk_level": "medium",
  "reputation_summary": "Empresa do setor de serviços com grande volume provável de reviews no Google Maps e Reclame Aqui. Necessita de monitoramento centralizado para evitar desgaste da marca.",
  "recommended_pitch": "Olá [Nome], notamos que a [Empresa] expandiu sua presença em [Cidade/UF]. Como vocês gerenciam as avaliações de clientes recebidas diariamente nas plataformas de reviews?",
  "key_selling_points": [
    "Centralização de avaliações em um único dashboard",
    "Alertas em tempo real para reviews negativos",
    "Resposta automática com IA treinada com o tom da marca"
  ]
}
`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      
      const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      return {
        icp_score: parsed.icp_score || 7.0,
        reputation_risk_level: parsed.reputation_risk_level || 'medium',
        reputation_summary: parsed.reputation_summary || 'Análise de reputação automatizada.',
        recommended_pitch: parsed.recommended_pitch || 'Apresente a plataforma Reputei para monitoramento unificado.',
        key_selling_points: parsed.key_selling_points || ['Monitoramento multicanal', 'Inteligência de Sentimento'],
      };
    } catch (error: any) {
      logger.error('Erro na análise de prospecção do Gemini', { error: error.message });
      return this.getFallbackAnalysis(company);
    }
  }

  /**
   * Gerar script de e-mail/mensagem de abordagem individualizado por decisor
   */
  async generateDecidorScript(
    companyName: string,
    decidor: KipflowDecidorResult
  ): Promise<string> {
    try {
      if (!this.genAI) {
        return `Olá ${decidor.name}, gostaria de apresentar como o Reputei ajuda empresas do seu setor a proteger sua marca e automatizar respostas no Google e Reclame Aqui.`;
      }

      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `
Escreva uma mensagem de abordagem fria (Cold Outreach) direta, concisa e personalizada em português para:
Decisor: ${decidor.name}
Cargo: ${decidor.role}
Empresa: ${companyName}

Produto: **Reputei** (Monitoramento de Reputação Online com IA).
Foco da mensagem: Como proteger a nota da marca no Google Maps / Reclame Aqui e economizar tempo da equipe de suporte/CX.
Tamanho máximo: 3 parágrafos curtos.
`;

      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error: any) {
      return `Olá ${decidor.name}, gostaria de apresentar como o Reputei apoia a ${companyName} na gestão da reputação e satisfação dos clientes.`;
    }
  }

  private getFallbackAnalysis(company: KipflowCompanyResult): ProspectAnalysisResult {
    return {
      icp_score: 7.5,
      reputation_risk_level: 'medium',
      reputation_summary: `Empresa ${company.company_name} no segmento ${company.cnae_description || 'Comercial/Serviços'} possui forte potencial para consolidação de reviews.`,
      recommended_pitch: `Olá! Como a ${company.trade_name || company.company_name} gerencia as reclamações e notas no Google Maps hoje?`,
      key_selling_points: [
        'Dashboard unificado com alertas de sentimentos negativos',
        'Copilot de IA para resposta rápida',
        'Relatórios consolidados de reputação'
      ]
    };
  }
}

export const prospectingAgent = new ProspectingAgent();
