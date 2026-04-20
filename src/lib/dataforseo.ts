/**
 * DataForSEO Client for Reputei
 * Documentation: https://docs.dataforseo.com/v3/
 */

const BASE_URL = 'https://api.dataforseo.com/v3';
// Usando a credencial base64 fornecida no prompt
const AUTH_HEADER = 'Basic bmV0c2VydmljZXNvZnR3YXJlQGdtYWlsLmNvbTo5MTVjNGYwM2Q1MDI5YjE2';

export interface DataForSEOTaskResponse {
  status_code: number;
  status_message: string;
  tasks: any[];
}

/**
 * Faz chamadas genéricas para a DataForSEO
 */
async function dfFetch(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': AUTH_HEADER,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DataForSEO API Error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Módulo de Onboarding: Busca o hotel para obter o url_path
 * @param hotelName Nome do hotel
 * @param city Cidade
 * @param tag Tag para rastreamento (ex: subscriber_id)
 */
export async function tripadvisorSearchTask(hotelName: string, city: string, tag: string) {
  const body = [
    {
      keyword: `${hotelName} ${city}`,
      language_code: "pt",
      tag
    }
  ];

  const result = await dfFetch('/business_data/tripadvisor/search/task_post', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  return result as DataForSEOTaskResponse;
}

/**
 * Cria tarefa de coleta de reviews
 */
export async function tripadvisorReviewsTaskPost(urlPath: string, tag: string) {
  const body = [
    {
      url_path: urlPath,
      ratings: ["poor", "terrible"],
      sort_by: "most_recent",
      depth: 10,
      language_code: "pt",
      tag
    }
  ];

  const result = await dfFetch('/business_data/tripadvisor/reviews/task_post', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  return result as DataForSEOTaskResponse;
}

/**
 * Coleta o resultado da tarefa de reviews
 */
export async function tripadvisorReviewsTaskGet(taskId: string) {
  const result = await dfFetch(`/business_data/tripadvisor/reviews/task_get/${taskId}`);
  return result as DataForSEOTaskResponse;
}

/**
 * Lista tarefas prontas (alternativa ao webhook)
 */
export async function tripadvisorTasksReady() {
  const result = await dfFetch('/business_data/tripadvisor/reviews/tasks_ready');
  return result as DataForSEOTaskResponse;
}
