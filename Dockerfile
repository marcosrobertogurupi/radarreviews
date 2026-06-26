# Imagem base: Node.js 20 LTS + Playwright/Chromium (necessário para conectores que usam scraping)
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Copia arquivos de dependências primeiro (melhor cache do Docker)
COPY package*.json ./

# Instala dependências de produção + dev (precisamos do tsx para executar TypeScript)
RUN npm ci --include=dev

# Copia o restante do código
COPY . .

# Playwright: usa o Chromium da imagem base (evita download de ~400MB no build)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production

# Porta padrão — Railway sobrescreve via variável $PORT
EXPOSE 3001

# Inicia o servidor HTTP que já inclui o scheduler interno
CMD ["npx", "tsx", "src/api/server.ts"]
