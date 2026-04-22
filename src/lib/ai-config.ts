/**
 * Configuração Central de Inteligência Artificial
 * 
 * Centralizamos aqui para evitar o "ping-pong" de versões entre arquivos.
 * O modelo 'gemini-1.5-flash' é o mais estável e rápido para produção.
 */

export const AI_CONFIG = {
  model: 'gemini-1.5-flash',
  temperature: 0.1, // Baixa temperatura para respostas mais precisas e menos criativas
  maxOutputTokens: 1024,
  responseMimeType: 'application/json'
}
