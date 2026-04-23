# 📊 Relatório Executivo: Infraestrutura e Custos Estimados
**Projeto:** Reputei SaaS — Plataforma de Gestão de Reputação
**Data:** 23 de Abril de 2026

Este relatório detalha os serviços de terceiros integrados ao sistema, suas finalidades e a estimativa de custos mensais baseada em um volume moderado de uso.

## 1. Núcleo de Infraestrutura (Backend e Banco de Dados)

| Serviço | Finalidade | Plano Sugerido | Custo Estimado (Mensal) |
| :--- | :--- | :--- | :--- |
| **Supabase** | Banco de Dados (PostgreSQL), Autenticação e Storage | Pro Plan | **$25.00** (~R$ 130,00) |
| **Railway** | Hospedagem do Servidor API e Agendador (Scheduler) | Hobby / Pro | **$5.00 - $10.00** (~R$ 30 - 55) |
| **Vercel** | Hospedagem do Frontend (Dashboard e Admin) | Pro (Opcional) | **$0.00** (Free Tier atende bem) |

## 2. Motores de Coleta (Scrapers e APIs)

| Serviço | Finalidade | Modelo de Cobrança | Custo Estimado (Mensal) |
| :--- | :--- | :--- | :--- |
| **Apify** | Coleta de Instagram, Reclame Aqui e Trustpilot | Pay-per-event / Starter | **$15.00 - $30.00** (Depende do volume) |
| **DataForSEO** | Coleta de TripAdvisor e Google Maps (Backup) | Pay-per-request | **$10.00** (Uso sob demanda) |
| **Z-API / Evolution** | Disparo de alertas via WhatsApp | Mensalidade Fixa | **R$ 99,00** (Média do mercado) |

## 3. Inteligência Artificial (Processamento)

| Serviço | Finalidade | Modelo de Cobrança | Custo Estimado (Mensal) |
| :--- | :--- | :--- | :--- |
| **Google Gemini API** | Análise de Sentimento (1.5 Flash) e Copiloto | Pay-as-you-go | **$1.00 - $3.00** (Extremamente barato) |

---

## 📈 Resumo de Investimento (Estimativa)

*   **Custo Fixo Mínimo:** ~ **R$ 250,00 / mês** (Mantendo o sistema online com folga).
*   **Custo por Novo Cliente:** Praticamente irrisório, escalando apenas o uso da Apify e IA conforme o volume de reviews aumenta.

### Observações de Eficiência:
*   **Gemini 1.5 Flash:** Escolhemos este modelo justamente por ser até 10x mais barato que o GPT-4, mantendo a mesma precisão para português.
*   **Apify Optimization:** Com as travas de "Anti-Spam" e o intervalo de 2 horas que implementamos, reduzimos o seu custo potencial de Apify em cerca de **60%**.

---
*Gerado automaticamente pelo sistema de auditoria Reputei.*
