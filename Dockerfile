# Imagem oficial do Playwright com Chromium e dependências instaladas
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./

# Instala dependências (incluindo dev para o build)
RUN npm ci

# Copia o restante do código
COPY . .

# Build do TypeScript
RUN npm run build

# Configurações de tempo de execução
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production

# A porta será definida pelo Railway via variável de ambiente PORT
EXPOSE 3001

# Comando para iniciar o servidor API + Scheduler
CMD ["node", "dist/api/server.js"]
