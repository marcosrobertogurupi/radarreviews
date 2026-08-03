import { describe, it, expect, vi } from 'vitest';
import { KipflowClient } from '../src/lib/kipflow';
import { ProspectingAgent } from '../src/lib/prospecting-agent';

describe('Integração Kipflow & Agente de Prospecção', () => {
  it('deve retornar empresas simuladas ou via API na Kipflow', async () => {
    const client = new KipflowClient('test-key');
    const results = await client.searchCompanies({ query: 'Odontologia' });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('company_name');
  });

  it('deve buscar decisores de uma empresa no LinkedIn', async () => {
    const client = new KipflowClient('test-key');
    const decidors = await client.findCompanyDecidors('odontoexemplo.com.br');
    expect(Array.isArray(decidors)).toBe(true);
    expect(decidors.length).toBeGreaterThan(0);
    expect(decidors[0]).toHaveProperty('name');
    expect(decidors[0]).toHaveProperty('role');
  });

  it('deve analisar o ICP Fit e gerar pitch com o Agente Gemini 2.5 Flash', async () => {
    const agent = new ProspectingAgent();
    const analysis = await agent.analyzeProspect(
      { company_name: 'Empresa Teste LTDA', domain: 'empresateste.com.br' },
      [{ name: 'Carlos Silva', role: 'Diretor de CX' }]
    );
    expect(analysis).toHaveProperty('icp_score');
    expect(analysis).toHaveProperty('reputation_summary');
    expect(analysis.icp_score).toBeGreaterThanOrEqual(0);
  });
});
