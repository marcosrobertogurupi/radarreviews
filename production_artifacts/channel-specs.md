# Fichas técnicas — canais de coleta

Referência completa para implementação dos conectores.
Leia a seção do canal que está sendo implementado.

---

## Google Maps (google_maps) — Fase 1

**API:** Google Places API (New)
**Base URL:** `https://places.googleapis.com/v1`
**Auth:** API Key no header `X-Goog-Api-Key`
**Rate limit:** 600 req/min
**Docs:** https://developers.google.com/maps/documentation/places/web-service

### Buscar reviews de um local

```
GET https://places.googleapis.com/v1/places/{place_id}
Header: X-Goog-Api-Key: {GOOGLE_MAPS_API_KEY}
Header: X-Goog-FieldMask: id,displayName,rating,userRatingCount,reviews
```

O `place_id` fica em `connector.external_id`.

### Resposta relevante

```json
{
  "id": "ChIJ...",
  "displayName": { "text": "Nome do Local" },
  "rating": 4.2,
  "userRatingCount": 312,
  "reviews": [
    {
      "name": "places/ChIJ.../reviews/...",
      "relativePublishTimeDescription": "há 2 semanas",
      "rating": 5,
      "text": { "text": "Ótimo lugar!", "languageCode": "pt" },
      "authorAttribution": {
        "displayName": "João Silva",
        "uri": "https://...",
        "photoUri": "https://..."
      },
      "publishTime": "2024-11-15T14:30:00Z"
    }
  ]
}
```

### Mapeamento para NormalizedReview

```
external_id  ← reviews[].name (ID único da review)
rating       ← reviews[].rating
body         ← reviews[].text.text
language     ← reviews[].text.languageCode
author_name  ← reviews[].authorAttribution.displayName
published_at ← reviews[].publishTime
```

### Limitações

- API retorna no máximo 5 reviews por chamada
- Não há paginação para reviews — apenas os 5 mais recentes
- Para mais volume: Google Places API (Legacy) retorna até 5 também
- Não expõe o user_id do autor por privacidade

---

## TripAdvisor (tripadvisor) — Fase 1

**API:** Content API v2
**Base URL:** `https://api.content.tripadvisor.com/api/v1`
**Auth:** `?key={TRIPADVISOR_API_KEY}` como query param
**Rate limit:** 50 req/s no plano free, 5 reviews por chamada
**Docs:** https://tripadvisor.com/developers

### Buscar location_id por nome

```
GET /location/search?key={KEY}&searchQuery={nome}&language=pt
```

### Buscar reviews de um local

```
GET /location/{location_id}/reviews?key={KEY}&language=pt&limit=5&offset=0
```

O `location_id` fica em `connector.external_id`.
Implementar paginação com `offset` para buscar todos os reviews.

### Resposta relevante

```json
{
  "data": [
    {
      "id": 123456789,
      "lang": "pt",
      "location_id": 456,
      "published_date": "2024-11-10T10:00:00Z",
      "rating": 4,
      "helpful_votes": 12,
      "rating_image_url": "...",
      "url": "https://www.tripadvisor.com.br/...",
      "travel_date": "2024-10",
      "text": "Lugar incrível, recomendo muito!",
      "title": "Vale a visita",
      "trip_type": "Negócios",
      "user": {
        "username": "viajante123",
        "user_location": { "name": "São Paulo, SP" }
      }
    }
  ]
}
```

### Mapeamento para NormalizedReview

```
external_id  ← String(data[].id)
rating       ← data[].rating  (escala 1–5)
title        ← data[].title
body         ← data[].text
language     ← data[].lang
author_name  ← data[].user.username
url          ← data[].url
upvotes      ← data[].helpful_votes
published_at ← data[].published_date
```

---

## Consumidor.gov (consumidor_gov) — Fase 1

**Tipo:** Dados abertos — CSV mensal
**Fonte:** https://dados.gov.br/dados/conjuntos-dados/reclamacoes-consumidor-gov-br
**Auth:** Nenhuma
**Frequência de atualização:** Mensal
**Chave de busca:** CNPJ da empresa (`monitored_businesses.cnpj`)

### Processo de coleta

1. Baixar o CSV do mês atual e mês anterior de dados.gov.br
2. Parsear com `csv-parse` (biblioteca npm)
3. Filtrar por CNPJ das empresas monitoradas
4. Inserir como reviews normalizados

```typescript
import { parse } from 'csv-parse/sync'
import axios from 'axios'

const CSV_URL = 'https://dados.gov.br/dados/conjuntos-dados/...'  // URL atual
```

### Colunas do CSV

```
DataAbertura, DataFechamento, CodigoRegiao, NomeRegiao, CodigoUF, UF,
CodigoMunicipio, NomeMunicipio, Sexo, Faixa Etaria, CodigoAssunto,
Descricao do Assunto, Grupo Problema, Descricao Problema, NomFantasia,
CNPJ, Stratura, Segmento de Mercado, Area, Assunto, Problema,
Descricao, Nota do Consumidor, Avaliacao Reclamacao, CodigoParecer,
DescricaoParecer, NomeParecer, Resolvido, Tempo Resposta (em dias)
```

### Mapeamento para NormalizedReview

```
external_id       ← hash SHA256 de (CNPJ + DataAbertura + Descricao)
rating            ← "Nota do Consumidor" (1–5, null se vazio)
body              ← "Descricao"
title             ← "Descricao do Assunto"
is_resolved       ← "Resolvido" === 'S'
response_time_days ← parseInt("Tempo Resposta")
published_at      ← parseDate("DataAbertura")  // formato DD/MM/YYYY
tags              ← [Area, Segmento de Mercado]
```

### Gerar external_id via hash

```typescript
import { createHash } from 'crypto'

const external_id = createHash('sha256')
  .update(`${row.CNPJ}-${row.DataAbertura}-${row.Descricao}`)
  .digest('hex')
```

---

## Trustpilot (trustpilot) — Fase 1

**API:** Consumer API v1 (leitura pública, sem autenticação)
**Base URL:** `https://api.trustpilot.com/v1`
**Auth:** `?apikey={TRUSTPILOT_API_KEY}` — Developer Portal gratuito
**Rate limit:** 100 req/min
**Docs:** https://developers.trustpilot.com

### Buscar business unit por domínio

```
GET /business-units/find?apikey={KEY}&name={domínio}
Ex: /business-units/find?apikey={KEY}&name=empresa.com.br
```

O `business_unit_id` resultante fica em `connector.external_id`.

### Buscar reviews

```
GET /business-units/{business_unit_id}/reviews?apikey={KEY}&page=1&perPage=20&orderBy=createdat.desc
```

Implementar paginação com `page` até que `reviews` seja array vazio.

### Resposta relevante

```json
{
  "reviews": [
    {
      "id": "abc123",
      "stars": 4,
      "title": "Bom serviço",
      "text": "Atendimento rápido e eficiente.",
      "language": "pt",
      "createdAt": "2024-11-08T09:15:00Z",
      "updatedAt": "2024-11-08T09:15:00Z",
      "isVerified": true,
      "consumer": {
        "id": "user456",
        "displayName": "Maria Oliveira"
      },
      "links": [
        { "rel": "self", "href": "https://www.trustpilot.com/reviews/abc123" }
      ]
    }
  ],
  "nextPage": { "page": 2 }
}
```

### Mapeamento para NormalizedReview

```
external_id          ← reviews[].id
rating               ← reviews[].stars  (1–5)
title                ← reviews[].title
body                 ← reviews[].text
language             ← reviews[].language
author_name          ← reviews[].consumer.displayName
author_external_id   ← reviews[].consumer.id
url                  ← reviews[].links[].href (onde rel === 'self')
published_at         ← reviews[].createdAt
```

---

## Reddit (reddit) — Fase 1

> [!IMPORTANT]
> **Mudança em novembro/2025:** O Reddit encerrou o acesso self-service à API.
> Novas aplicações precisam de aprovação manual via Reddit Developer Support.
> Enquanto aguarda aprovação, use os **endpoints JSON públicos** abaixo.

### Modo 1 — Público (MVP, sem credenciais)

Funciona imediatamente sem nenhuma chave de API.
O conector detecta automaticamente se não há credenciais e usa este modo.

```
GET https://www.reddit.com/search.json?q={query}&sort=new&limit=25&t=week&raw_json=1
User-Agent: RadarDeReviews/1.0
```

Limitações do modo público:
- Rate limit: ~60 req/min (sem auth)
- Apenas dados públicos
- Sem acesso a subreddits privados

### Modo 2 — OAuth2 (producão, requer aprovação)

**Solicitar acesso em:** reddit.com/r/redditdev → Developer Support form

O que escrever no formulário:
```
App name: Reputei
Use case: Monitoramento de menções públicas de marcas em subreddits brasileiros
Data needed: Títulos e textos de posts públicos
Subreddits: Públicos brasileiros (r/brasil, r/investimentos, etc.)
Volume esperado: Baixo — coleta periódica a cada hora por empresa
```

Após aprovado, adicionar ao `.env`:
```
REDDIT_CLIENT_ID=seu_client_id
REDDIT_CLIENT_SECRET=seu_client_secret
```

**Auth:** OAuth 2.0 Client Credentials
**Token URL:** `https://www.reddit.com/api/v1/access_token`
**Base URL:** `https://oauth.reddit.com`
**Rate limit:** 100 req/min (com OAuth)

### Buscar menções (ambos os modos)

```
# Modo público
GET https://www.reddit.com/search.json?q={nome_empresa}&sort=new&limit=25&t=week

# Modo OAuth
GET https://oauth.reddit.com/search.json?q={nome_empresa}&sort=new&limit=25&t=week
Authorization: Bearer {accessToken}
```

Os termos de busca ficam em `connector.config.keywords` (array de strings).
Combinar: `connector.config.keywords.join(' OR ')`.

Subreddits opcionais em `connector.config.subreddits` (ex: `["r/brasil", "r/investimentos"]`).

### Obter token de acesso

```typescript
const tokenRes = await axios.post(
  'https://www.reddit.com/api/v1/access_token',
  'grant_type=client_credentials',
  {
    auth: {
      username: process.env.REDDIT_CLIENT_ID,
      password: process.env.REDDIT_CLIENT_SECRET,
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'RadarDeReviews/1.0 by seu_usuario',
    },
  }
)
const accessToken = tokenRes.data.access_token
// Token expira em 1 hora — cachear por 55 min
```

### Buscar menções da empresa

```
GET /search.json?q={nome_empresa}&sort=new&limit=25&t=week
Authorization: Bearer {accessToken}
User-Agent: RadarDeReviews/1.0
```

Os termos de busca ficam em `connector.config.keywords` (array de strings).
Combinar: `connector.config.keywords.join(' OR ')`.

### Resposta relevante

```json
{
  "data": {
    "children": [
      {
        "data": {
          "id": "post_abc123",
          "title": "Experiência péssima com Empresa X",
          "selftext": "Tentei contato 3 vezes e nunca responderam...",
          "subreddit": "brasil",
          "author": "usuario_reddit",
          "score": 45,
          "num_comments": 12,
          "url": "https://www.reddit.com/r/brasil/comments/...",
          "created_utc": 1699999999,
          "permalink": "/r/brasil/comments/..."
        }
      }
    ]
  }
}
```

### Mapeamento para NormalizedReview

```
external_id    ← data.id
rating         ← undefined  (Reddit não tem nota formal)
title          ← data.title
body           ← data.selftext (pode ser vazio para link posts)
author_name    ← data.author
url            ← 'https://reddit.com' + data.permalink
upvotes        ← data.score
comment_count  ← data.num_comments
published_at   ← new Date(data.created_utc * 1000).toISOString()
tags           ← [data.subreddit]
```

---

## Facebook (facebook) — Fase 2

**API:** Meta Graph API v19+
**Base URL:** `https://graph.facebook.com/v19.0`
**Auth:** Page Access Token (OAuth — cliente autoriza no onboarding)
**Rate limit:** 200 req/hora por token de página
**Permissão necessária:** `pages_read_engagement`, `pages_show_list`
**Docs:** https://developers.facebook.com/docs/graph-api

O Page Access Token fica no Vault (`connector.vault_secret_id`).

### Buscar ratings de uma página

```
GET /{page_id}/ratings?fields=reviewer,review_text,rating,created_time&limit=25
Authorization: Bearer {page_access_token}
```

O `page_id` fica em `connector.external_id`.

### Mapeamento para NormalizedReview

```
external_id   ← reviewer.id + '_' + created_time (sem ID próprio)
rating        ← rating  (1–5)
body          ← review_text
author_name   ← reviewer.name
author_external_id ← reviewer.id
published_at  ← created_time
```

---

## Instagram (instagram) — Fase 2

**API:** Instagram Graph API
**Base URL:** `https://graph.instagram.com/v19.0`
**Auth:** Instagram User Access Token (OAuth — conta própria do cliente)
**Permissão:** `instagram_basic`, `instagram_manage_comments`
**Docs:** https://developers.facebook.com/docs/instagram-api

O token fica no Vault. O cliente conecta a própria conta no onboarding do SaaS.

### Fluxo de coleta

1. Buscar posts recentes: `GET /{user_id}/media?fields=id,caption,timestamp,like_count,comments_count`
2. Para cada post, buscar comentários: `GET /{media_id}/comments?fields=id,text,username,timestamp`
3. Filtrar comentários com palavras de feedback (config em `connector.config.feedback_keywords`)

### Mapeamento para NormalizedReview

```
external_id    ← comment.id
body           ← comment.text
author_name    ← comment.username
published_at   ← comment.timestamp
tags           ← ['instagram_comment']
```

---

## Reclame Aqui (reclame_aqui) — Fase 3

**Acesso:** API parceiro (preferencial) ou scraping com Playwright
**URL base:** `https://www.reclameaqui.com.br/{slug-da-empresa}`
**Chave:** slug da empresa em `connector.external_id`

> Implementar apenas na Fase 3. Consultar `skills/scraper.md`
> quando chegar nesta fase (arquivo a ser criado).

---

## Configuração padrão de intervalos (connector.config)

Sugestão de intervalo de coleta por canal:

```json
{
  "google_maps":    { "interval_minutes": 1440 },
  "tripadvisor":    { "interval_minutes": 1440 },
  "consumidor_gov": { "interval_minutes": 43200 },
  "trustpilot":     { "interval_minutes": 720  },
  "reddit":         { "interval_minutes": 60   },
  "facebook":       { "interval_minutes": 360  },
  "instagram":      { "interval_minutes": 360  },
  "reclame_aqui":   { "interval_minutes": 720  }
}
```
