/**
 * Configuração Central de Inteligência Artificial
 * 
 * Centralizamos aqui para evitar o "ping-pong" de versões entre arquivos.
 * O modelo 'gemini-1.5-flash' é o mais estável e rápido para produção.
 */

export const AI_CONFIG = {
  model: 'gemini-2.5-flash',
  embeddingModel: 'models/gemini-embedding-001',
  temperature: 0.1, 
  maxOutputTokens: 1024,
  responseMimeType: 'application/json'
}
