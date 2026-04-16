/**
 * Cloudflare Worker — Reddit Proxy Relay para o Projeto Reputei
 * 
 * Este script deve ser colado em um "Worker" na Cloudflare.
 * Ele serve para desviar o tráfego do Railway (IP bloqueado) através da rede Cloudflare (IP limpo).
 */

const REDDIT_BASE = 'https://www.reddit.com';

export default {
  async fetch(request, env) {
    // 1. Lidar com Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'X-Proxy-Key',
        }
      });
    }

    // 2. Segurança: Chave de Autenticação
    // Configure esta variável em Settings -> Variables -> Secrets no painel do Cloudflare Worker
    const proxyKey = request.headers.get('X-Proxy-Key');
    if (proxyKey !== env.PROXY_SECRET_KEY) {
      return new Response('Não autorizado: Chave de proxy inválida.', { status: 401 });
    }

    // 3. Extrair parâmetros da URL
    const url = new URL(request.url);
    const redditPath = url.searchParams.get('path');

    if (!redditPath) {
      return new Response('Erro: Parâmetro "path" é obrigatório (ex: ?path=/search.json).', { status: 400 });
    }

    // 4. Montar URL final do Reddit
    const redditUrl = new URL(REDDIT_BASE + redditPath);
    url.searchParams.forEach((value, key) => {
      if (key !== 'path') {
        redditUrl.searchParams.set(key, value);
      }
    });

    // 5. Fazer a chamada ao Reddit simulando navegador real
    try {
      const response = await fetch(redditUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
        }
      });

      // 6. Retornar resposta ao Railway
      const data = await response.text();
      return new Response(data, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Reddit-Status': String(response.status),
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
