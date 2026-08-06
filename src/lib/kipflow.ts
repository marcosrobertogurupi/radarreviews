import axios, { AxiosInstance } from 'axios';
import { logger } from './logger.js';

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
  private explicitApiKey?: string;

  constructor(apiKey?: string) {
    this.explicitApiKey = apiKey;
  }

  private getApiKey(): string {
    return this.explicitApiKey || process.env.KIPFLOW_API_KEY || '';
  }

  private getBaseUrl(): string {
    return process.env.KIPFLOW_API_URL || 'https://api.kipflow.io';
  }

  private getHttpClient(): AxiosInstance {
    const apiKey = this.getApiKey();
    return axios.create({
      baseURL: this.getBaseUrl(),
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Buscar empresas por filtros (CNPJ, Domínio, Nome, etc.) diretamente na API Kipflow
   */
  async searchCompanies(filters: KipflowCompanySearchFilters): Promise<KipflowCompanyResult[]> {
    const apiKey = this.getApiKey();
    logger.info('Iniciando busca de empresas na Kipflow', { filters, hasApiKey: !!apiKey });

    if (!apiKey || apiKey.includes('test')) {
      logger.warn('KIPFLOW_API_KEY não configurada ou em ambiente de teste. Retornando dados simulados.');
      return this.getMockCompanies(filters);
    }

    try {
      const http = this.getHttpClient();
      const rawInput = (filters.cnpj || filters.query || filters.domain || '').trim();
      const cleanDigits = rawInput.replace(/\D/g, '');

      const params: Record<string, string> = {
        datasets: 'basic,address,online_presence,partners,complete',
      };

      if (cleanDigits.length === 14) {
        params.cnpj = cleanDigits;
      } else if (filters.domain || (rawInput.includes('.') && !rawInput.includes(' '))) {
        params.domain = filters.domain || (rawInput.replace(/https?:\/\//, '').split('/')[0] ?? rawInput);
      } else if (filters.cnpj) {
        params.cnpj = filters.cnpj;
      } else {
        // Se a busca for genérica por texto, passar como cnpj ou tentar extrair o máximo de dígitos
        if (cleanDigits.length > 0) {
          params.cnpj = cleanDigits;
        } else if (rawInput) {
          params.domain = rawInput;
        }
      }

      const response = await http.get('/companies/v1/search', { params });
      
      if (response.data && response.data.success && response.data.data) {
        return this.normalizeCompanyResponse([response.data.data]);
      } else if (response.data && Array.isArray(response.data.results)) {
        return this.normalizeCompanyResponse(response.data.results.map((r: any) => r.data || r));
      }

      return [];
    } catch (error: any) {
      logger.error('Erro ao buscar empresas na Kipflow API', {
        error: error.response?.data || error.message,
        status: error.response?.status,
        filters
      });

      // Se ocorreu um erro 404/COMPANY_NOT_FOUND, significa que a empresa realmente não existe na Kipflow
      if (error.response?.status === 404 || error.response?.data?.error?.code === 'COMPANY_NOT_FOUND') {
        return [];
      }

      // Se houver falha de rede/API e a chave estiver configurada, podemos retornar vazio ou relançar o erro
      return [];
    }
  }

  /**
   * Buscar dados de uma empresa específica por CNPJ ou Domínio (Para enriquecimento)
   */
  async getCompanyByCnpjOrDomain(cnpjOrDomain: string): Promise<KipflowCompanyResult | null> {
    const results = await this.searchCompanies({ query: cnpjOrDomain, cnpj: cnpjOrDomain });
    return results[0] || null;
  }

  /**
   * Buscar decisores/personas para uma determinada empresa (a partir do quadro de sócios/diretoria)
   */
  async findCompanyDecidors(domainOrCompanyName: string, rolesFilter: string[] = ['diretor', 'gerente', 'ceo', 'cmo', 'head', 'cx']): Promise<KipflowDecidorResult[]> {
    try {
      logger.info('Buscando decisores via Kipflow', { domainOrCompanyName });
      const apiKey = this.getApiKey();

      if (!apiKey || apiKey.includes('test')) {
        return this.getMockDecidors(domainOrCompanyName);
      }

      const company = await this.getCompanyByCnpjOrDomain(domainOrCompanyName);
      const socios = company?.raw?.socios;

      if (Array.isArray(socios) && socios.length > 0) {
        return socios.map((s: any) => ({
          name: s.nome_socio || s.nome,
          role: s.qualificacao_socio || s.qualificacao || 'Sócio / Administrador',
          department: 'Quadro de Sócios / Diretoria',
          phone: company?.phone,
          email: company?.email,
        }));
      }

      return [];
    } catch (error: any) {
      logger.error('Erro ao buscar decisores na Kipflow', { error: error.message, domainOrCompanyName });
      return [];
    }
  }

  /**
   * Revelar e-mail ou telefone direto de um decisor
   */
  async enrichDecidorContact(decidor: KipflowDecidorResult, domainOrCnpj?: string): Promise<{ email?: string; phone?: string }> {
    try {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        return {
          email: decidor.email || `${(decidor.name.split(' ')[0] || 'contato').toLowerCase()}@${domainOrCnpj || 'empresa.com.br'}`,
          phone: decidor.phone || '(11) 9' + Math.floor(10000000 + Math.random() * 90000000),
        };
      }

      const cleanCnpj = (domainOrCnpj || '').replace(/\D/g, '');
      if (cleanCnpj.length === 14 && decidor.name) {
        const http = this.getHttpClient();
        const response = await http.post('/contacts/v1/emails/generate-by-cnpj', {
          cnpj: cleanCnpj,
          full_name: decidor.name,
        });

        if (response.data?.success && response.data?.email) {
          return { email: response.data.email, phone: decidor.phone };
        }
      }

      return { email: decidor.email, phone: decidor.phone };
    } catch (error: any) {
      logger.error('Erro ao revelar contatos do decisor na Kipflow', { error: error.message, decidorName: decidor?.name });
      return { email: decidor.email, phone: decidor.phone };
    }
  }

  private normalizeCompanyResponse(items: any[]): KipflowCompanyResult[] {
    if (!Array.isArray(items)) return [];
    
    return items.map((item) => {
      const data = item.data || item;
      const cnpj = data.cnpj || data.tax_id;
      const company_name = data.razao_social || data.company_name || data.name || data.nome_fantasia;
      const trade_name = data.nome_fantasia || data.trade_name;
      const domain = data.dominio || data.domain || (data.website ? data.website.replace(/https?:\/\//, '') : undefined);
      
      const cnae_code = data.cnae_principal_subclasse ? String(data.cnae_principal_subclasse) : (data.cnae_principal_codigo || data.cnae_code);
      const cnae_description = data.cnae_principal_desc_subclasse || data.cnae_principal_descricao || data.cnae_description;
      
      const size = data.porte || data.size;
      const estimated_revenue = data.faixa_faturamento_grupo || (data.faturamento ? `R$ ${Number(data.faturamento).toLocaleString('pt-BR')}` : undefined) || data.estimated_revenue;
      
      const city = data.municipio || data.city || data.endereco?.cidade;
      const state = data.uf || data.state || data.endereco?.uf;
      const phone = data.telefone || data.phone;
      const email = data.email;
      const website = data.website || data.site || (data.linkedin_url ? `https://${data.linkedin_url}` : undefined);

      return {
        cnpj,
        company_name: company_name || `Empresa ${cnpj || ''}`,
        trade_name,
        domain,
        cnae_code,
        cnae_description,
        size,
        estimated_revenue,
        city,
        state,
        phone,
        email,
        website,
        raw: data,
      };
    });
  }

  // Dados mock mantidos apenas para fallback de testes sem API key
  private getMockCompanies(filters: KipflowCompanySearchFilters): KipflowCompanyResult[] {
    const q = (filters.query || filters.cnpj || '').trim();
    const cleanCnpj = q.replace(/\D/g, '');

    if (cleanCnpj.length === 14) {
      return [
        {
          cnpj: cleanCnpj,
          company_name: `Empresa Cadastrada (${cleanCnpj})`,
          trade_name: 'Unidade Comercial Registrada',
          domain: 'empresa-consulta.com.br',
          cnae_code: '8630-5/04',
          cnae_description: 'Atividade Comercial / Serviços em Geral',
          size: 'Médio',
          estimated_revenue: 'R$ 2.000.000 a R$ 5.000.000',
          city: 'Palmas',
          state: 'TO',
          phone: '(63) 3215-9000',
          email: 'contato@empresa-consulta.com.br',
          website: 'https://empresa-consulta.com.br',
        }
      ];
    }

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
      }
    ];
  }
}

export const kipflowClient = new KipflowClient();

