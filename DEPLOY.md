# Reputei — Guia de Deploy para Produção/Testes

## Visão geral dos serviços

| Serviço | Pasta | Plataforma | URL esperada |
|---|---|---|---|
| **Website / Parceiros** | `website/` | Vercel | `reputei.vercel.app` |
| **Portal do Assinante** | `portal/` | Vercel | `portal-reputei.vercel.app` |
| **Painel Admin** | `admin/` | Vercel | `admin-reputei.vercel.app` |
| **API (Copilot + Onboarding)** | raiz `src/api/` | Railway | `reputei-api.railway.app` |

> O banco de dados (Supabase) já está hospedado em nuvem — nenhuma ação necessária.

---

## Pré-requisitos

- Conta gratuita no [Vercel](https://vercel.com) (GitHub login)
- Conta gratuita no [Railway](https://railway.app) (GitHub login)
- [Vercel CLI](https://vercel.com/cli): `npm i -g vercel`
- Repositório no GitHub (ou deploy direto pela pasta)

---

## PASSO 1 — Deploy da API no Railway

### 1.1 Criar projeto
1. Acesse [railway.app/new](https://railway.app/new)
2. Clique em **"Deploy from GitHub repo"**
3. Selecione este repositório
4. Railway detecta o `railway.json` automaticamente

### 1.2 Variáveis de ambiente (Railway → Settings → Variables)

```
SUPABASE_URL         = https://lkwahbipteiqqzkmfrac.supabase.co
SUPABASE_SERVICE_ROLE_KEY = <sua chave service_role do arquivo .env>
GEMINI_API_KEY       = <sua chave Gemini do arquivo .env>
```

> As chaves estão no arquivo `.env` na raiz do projeto.

### 1.3 Aguardar o deploy
Após configurar as variáveis, o Railway faz o deploy automaticamente.
Anote a URL gerada — algo como `https://api-production-24e1.up.railway.app`.

### 1.4 Testar a API
```
GET https://api-production-24e1.up.railway.app/health
→ {"ok":true,"ts":"..."}
```

---

## PASSO 2 — Deploy do Portal do Assinante no Vercel

### 2.1 Via Vercel CLI (terminal na raiz do projeto)
```bash
cd portal
vercel
```
Responda as perguntas:
- Set up and deploy? **Y**
- Which scope? sua conta
- Link to existing project? **N**
- Project name? `reputei-portal`
- In which directory? `.` (ponto)
- Override settings? **N**

### 2.2 Variáveis de ambiente (Vercel → Project → Settings → Environment Variables)

```
VITE_SUPABASE_URL      = https://lkwahbipteiqqzkmfrac.supabase.co
VITE_SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxrd2FoYmlwdGVpcXF6a21mcmFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MTM4MjcsImV4cCI6MjA5MTQ4OTgyN30.tTEK34V1G1aIPDggdzv2lPx07eOOE2_umrRLoXErN6U
VITE_API_URL           = https://api-production-24e1.up.railway.app
```

> Substitua a URL da API pela URL real gerada no Railway (Passo 1).

### 2.3 Fazer o deploy de produção
```bash
vercel --prod
```

---

## PASSO 3 — Deploy do Painel Admin no Vercel

```bash
cd admin
vercel
```
- Project name: `reputei-admin`

### Variáveis de ambiente:
```
VITE_SUPABASE_URL      = https://lkwahbipteiqqzkmfrac.supabase.co
VITE_SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxrd2FoYmlwdGVpcXF6a21mcmFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MTM4MjcsImV4cCI6MjA5MTQ4OTgyN30.tTEK34V1G1aIPDggdzv2lPx07eOOE2_umrRLoXErN6U
```

```bash
vercel --prod
```

---

## PASSO 4 — Deploy do Website (Parceiros) no Vercel

```bash
cd website
vercel
```
- Project name: `reputei-website`
- Framework detectado automaticamente: **Next.js**

Sem variáveis de ambiente — o site é estático.

```bash
vercel --prod
```

---

## PASSO 5 — Atualizar CORS da API (após ter as URLs do Vercel)

Edite `src/api/server.ts` e substitua `'*'` pelas URLs reais:

```typescript
// Substitua esta linha:
res.setHeader('Access-Control-Allow-Origin', '*')

// Por esta (com as URLs reais do Vercel):
const allowed = [
  'https://reputei-portal.vercel.app',
  'https://reputei-admin.vercel.app',
  'https://reputei-website.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
]
const origin = req.headers.origin ?? ''
res.setHeader('Access-Control-Allow-Origin', allowed.includes(origin) ? origin : allowed[0])
```

Depois faça push — o Railway atualiza automaticamente.

---

## Checklist pós-deploy

- [ ] `GET /health` da API retorna 200
- [ ] Portal: tela de login carrega em `https://reputei-portal.vercel.app`
- [ ] Portal: login com `marcosroberto_gurupi@hotmail.com` funciona
- [ ] Portal: Copilot responde (IA conectada)
- [ ] Portal: Onboarding cria novo tenant
- [ ] Admin: login e visualização de reviews funcionam
- [ ] Website: `https://reputei-website.vercel.app/parceiros` carrega
- [ ] Website: simulador de ganhos calcula em tempo real
- [ ] Website: formulário de parceiros exibe sucesso ao enviar

---

## URLs de acesso local (desenvolvimento)

| Serviço | Comando | URL |
|---|---|---|
| Website | `cd website && npm run dev` | http://localhost:3000/parceiros |
| Portal | `cd portal && npm run dev` | http://localhost:5174 |
| Admin | `cd admin && npm run dev` | http://localhost:5173 |
| API | `npm run dev:api` | http://localhost:3001 |
| Todos | `INICIAR_SISTEMA.bat` | todos acima |

---

## Credenciais de teste (assinante)

- **E-mail:** `marcosroberto_gurupi@hotmail.com`
- **Senha:** `Gauderio@036927`
- Tenants vinculados: Copacabana Palace, Grupo iFood, Localiza, Nubank

## Credenciais de teste (Hotel Ideal — owner original)

- **E-mail:** `netservicesoftware@gmail.com`
- **Senha:** *(definida no Supabase Auth — use "Forgot password" se necessário)*
