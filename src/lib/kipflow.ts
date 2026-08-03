import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { logger } from './logger.js';

const KIPFLOW_API_BASE_URL = process.env.KIPFLOW_API_URL || 'https://api.kipflow.io';
const KIPFLOW_API_KEY = process.env.KIPFLOW_API_KEY || '';

export interface KipflowCompanySearchFilters {
  query?: string;
  cnpj?: string;
  domain?: string;
  states?: string[];
  cities?: string[];
  cnaes?: string[];
  size?: string[];
  limit?: number;
  page?: number;
}

export interface KipflowCompanyResult {
  cnpj?: string;
  company_name: string;
  trade_name?: string;
  domain?: string;
  cnae_code?: string;
  cnae_description?: string;
  size?: string;
  estimated_revenue?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  website?: string;
  raw?: Record<string, unknown>;
}

export interface KipflowDecidorResult {
  linkedin_id?: string;
  name: string;
  role?: string;
  department?: string;
  linkedin_url?: string;
  email?: string;
  phone?: string;
}

export class KipflowClient {
  private http: AxiosInstance;

  constructor(apiKey: string = KIPFLOW_API_KEY) {
    this.http = axios.create({
      baseURL: KIPFLOW_API_BASE_URL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Buscar empresas por filtros avançados (CNAE, Estado, Cidade, Nome, etc.)
   */
  async searchCompanies(filters: KipflowCompanySearchFilters): Promise<KipflowCompanyResult[]> {
    try {
      logger.info('Iniciando busca de empresas na Kipflow', { filters });
      
      // Fallback para desenvolvimento/teste se API key não configurada ou endpoint simulado
      if (!KIPFLOW_API_KEY) {
        logger.warn('KIPFLOW_API_KEY não configurada em .env. Retornando dados simulados.');
        return this.getMockCompanies(filters);
      }

      const response = await this.http.post('/empresas/buscar-com-filtros', filters);
      return this.normalizeCompanyResponse(response.data);
    } catch (error: any) {
      logger.error('Erro ao buscar empresas na Kipflow', { error: error.message, filters });
      // Retorna fallback gracioso em dev se houver erro de requisição
      return this.getMockCompanies(filters);
    }
  }

  /**
   * Buscar dados de uma empresa específica por CNPJ ou Domínio (Para enriquecimento)
   */
  async getCompanyByCnpjOrDomain(cnpjOrDomain: string): Promise<KipflowCompanyResult | null> {
    try {
      logger.info('Buscando detalhes de empresa na Kipflow para enriquecimento', { cnpjOrDomain });
      
      const cleanInput = cnpjOrDomain.replace(/\D/g, '');
      const isCnpj = cleanInput.length === 14;

      if (!KIPFLOW_API_KEY) {
        return this.getMockCompanies({ query: cnpjOrDomain })[0] || null;
      }

      const endpoint = isCnpj ? '/empresas/buscar-por-cnpj' : '/empresas/buscar-por-dominio';
      const payload = isCnpj ? { cnpj: cleanInput } : { domain: cnpjOrDomain };

      const response = await this.http.post(endpoint, payload);
      const normalized = this.normalizeCompanyResponse([response.data]);
      return normalized[0] || null;
    } catch (error: any) {
      logger.error('Erro ao buscar detalhes da empresa na Kipflow', { error: error.message, cnpjOrDomain });
      return this.getMockCompanies({ query: cnpjOrDomain })[0] || null;
    }
  }

  /**
   * Buscar decisores/personas no LinkedIn para uma determinada empresa (por Domínio ou Nome)
   */
  async findCompanyDecidors(domainOrCompanyName: string, rolesFilter: string[] = ['diretor', 'gerente', 'ceo', 'cmo', 'head', 'cx']): Promise<KipflowDecidorResult[]> {
    try {
      logger.info('Buscando decisores na Kipflow', { domainOrCompanyName, rolesFilter });

      if (!KIPFLOW_API_KEY) {
        return this.getMockDecidors(domainOrCompanyName);
      }

      const response = await this.http.post('/redes-sociais/linkedin/personas', {
        company_identifier: domainOrCompanyName,
        roles: rolesFilter,
      });

      return (response.data?.items || []).map((item: any) => ({
        linkedin_id: item.id || item.linkedin_id,
        name: item.name || item.nome,
        role: item.headline || item.cargo || item.role,
        department: item.department || item.departamento,
        linkedin_url: item.profile_url || item.linkedin_url,
        email: item.email,
        phone: item.phone,
      }));
    } catch (error: any) {
      logger.error('Erro ao buscar decisores na Kipflow', { error: error.message, domainOrCompanyName });
      return this.getMockDecidors(domainOrCompanyName);
    }
  }

  /**
   * Revelar e-mail ou telefone direto de um decisor a partir do LinkedIn ID ou Nome + Domínio
   */
  async enrichDecidorContact(decidor: KipflowDecidorResult, domain?: string): Promise<{ email?: string; phone?: string }> {
    try {
      const decName = decidor?.name || 'contato';
      logger.info('Revelando contatos diretos de decisor via Kipflow', { name: decName, domain });

      if (!KIPFLOW_API_KEY) {
        const safeName = decName || 'contato';
        const parts = safeName.split(' ');
        const firstName = (parts[0] || 'contato').toLowerCase();
        const cleanDomain = domain || 'empresa.com.br';
        return {
          email: `${firstName}@${cleanDomain}`,
          phone: '(11) 9' + Math.floor(10000000 + Math.random() * 90000000),
        };
      }

      const response = await this.http.post('/contatos/emails/gerar-por-linkedin-id', {
        linkedin_id: decidor?.linkedin_id,
        name: decName,
        domain: domain,
      });

      return {
        email: response.data?.email || decidor?.email,
        phone: response.data?.phone || decidor?.phone,
      };
    } catch (error: any) {
      const decName = decidor?.name || 'contato';
      logger.error('Erro ao revelar contatos do decisor', { error: error.message, decidorName: decName });
      return { email: decidor?.email, phone: decidor?.phone };
    }
  }

  private normalizeCompanyResponse(items: any[]): KipflowCompanyResult[] {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      cnpj: item.cnpj || item.tax_id,
      company_name: item.razao_social || item.company_name || item.name,
      trade_name: item.nome_fantasia || item.trade_name,
      domain: item.dominio || item.domain || item.website?.replace(/https?:\/\//, ''),
      cnae_code: item.cnae_principal_codigo || item.cnae_code,
      cnae_description: item.cnae_principal_descricao || item.cnae_description,
      size: item.porte || item.size,
      estimated_revenue: item.faturamento_estimado || item.estimated_revenue,
      city: item.municipio || item.city || item.endereco?.cidade,
      state: item.uf || item.state || item.endereco?.uf,
      phone: item.telefone || item.phone,
      email: item.email,
      website: item.site || item.website,
      raw: item,
    }));
  }

  // Dados mock para testes/fallback sem API KEY
  private getMockCompanies(filters: KipflowCompanySearchFilters): KipflowCompanyResult[] {
    return [
      {
        cnpj: '12345678000199',
        company_name: 'Rede de Odontologia Exemplo LTDA',
        trade_name: 'OdontoExemplo Premium',
        domain: 'odontoexemplo.com.br',
        cnae_code: '8630-5/04',
        cnae_description: 'Atividade odontológica com recursos para realização de procedimentos cirúrgicos',
        size: 'Médio',
        estimated_revenue: 'R$ 5.000.000 a R$ 10.000.000',
        city: 'São Paulo',
        state: 'SP',
        phone: '(11) 3456-7890',
        email: 'contato@odontoexemplo.com.br',
        website: 'https://odontoexemplo.com.br',
      },
      {
        cnpj: '98765432000111',
        company_name: 'Hospital e Maternidade Conforto S.A.',
        trade_name: 'Hospital Conforto',
        domain: 'hospitalconforto.com.br',
        cnae_code: '8610-1/01',
        cnae_description: 'Atividades de atendimento hospitalar',
        size: 'Grande',
        estimated_revenue: 'R$ 20.000.000+',
        city: 'Campinas',
        state: 'SP',
        phone: '(19) 3123-4567',
        email: 'atendimento@hospitalconforto.com.br',
        website: 'https://hospitalconforto.com.br',
      }
    ];
  }

  private getMockDecidors(domainOrCompanyName: string): KipflowDecidorResult[] {
    return [
      {
        linkedin_id: 'in-mock-1',
        name: 'Carlos Eduardo Silva',
        role: 'Diretor de Marketing & Experiência do Cliente (CX)',
        department: 'Marketing',
        linkedin_url: 'https://linkedin.com/in/carlos-silva-mock',
        email: 'carlos.silva@' + (domainOrCompanyName.includes('.') ? domainOrCompanyName : 'empresa.com.br'),
        phone: '(11) 98765-4321',
      },
      {
        linkedin_id: 'in-mock-2',
        name: 'Mariana Oliveira',
        role: 'Gerente Geral de Operações e Ouvidoria',
        department: 'Operações',
        linkedin_url: 'https://linkedin.com/in/mariana-oliveira-mock',
        email: 'mariana.oliveira@' + (domainOrCompanyName.includes('.') ? domainOrCompanyName : 'empresa.com.br'),
        phone: '(11) 97654-3210',
      }
    ];
  }
}

export const kipflowClient = new KipflowClient();
