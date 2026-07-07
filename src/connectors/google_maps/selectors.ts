// Seletores do Google Maps (2024-2025)
//
// Google usa class names aleatórias que mudam a cada deploy.
// Estratégia: múltiplos seletores por elemento, do mais estável (aria/role/data)
// ao menos estável (class names).
//
// Para REVIEW_ITEM: a extração não depende mais só de data-review-id —
// o scraper gera um ID fallback para não perder reviews.

export const GMAPS_SELECTORS = {

  // Botão da aba de avaliações
  REVIEWS_TAB: [
    'button[aria-label*="avalia" i]',
    'button[aria-label*="review" i]',
    'div[role="tab"]:has-text("Avalia")',
    'button[jsaction*="pane.rating"]',
    'button[aria-label*="avaliações"]',
    'button[aria-label*="Avaliações"]',
    '[role="tab"][aria-label*="Avaliações"]',
    '[role="tab"][aria-label*="avaliações"]',
    'button[aria-label*="reviews"]',
    'button[aria-label*="Reviews"]',
    'button:has-text("Avaliações")',
    'button:has-text("Reviews")',
  ],

  // Painel lateral scrollável com os reviews
  REVIEWS_PANEL: [
    'div.m6QErb[aria-label*="Avaliações"]',
    'div.m6QErb[aria-label*="avaliações"]',
    'div.m6QErb[aria-label*="Reviews"]',
    'div[aria-label*="Avaliações para"]',
    'div[aria-label*="Reviews for"]',
    'div[role="main"] div[tabindex="-1"]',
    'div[data-scroll-config]',
    'div.m6QErb',
  ],

  // Botão de ordenação
  SORT_BUTTON: [
    'button[aria-label*="Classificar avaliações"]',
    'button[aria-label*="Classificar"]',
    'button[aria-label*="Sort reviews"]',
    'button[aria-label*="Sort"]',
    'button[data-value="sort"]',
    '[jsaction*="pane.review.sort"]',
    'button[jslog*="sort"]',
  ],

  // Opção "Mais recentes" no dropdown de ordenação
  SORT_NEWEST: [
    '[role="menuitemradio"][aria-label*="Mais recentes"]',
    '[role="menuitem"][aria-label*="Mais recentes"]',
    '[role="menuitemradio"][aria-label*="Newest"]',
    '[role="option"][aria-label*="Mais recentes"]',
    'li:has-text("Mais recentes")',
    '[role="menuitemradio"]:nth-child(2)',
  ],

  // Container de cada review — do mais estável ao mais frágil
  REVIEW_ITEM: [
    'div[data-review-id]',      // atributo primário — Google Maps usa isso historicamente
    'div[class*="jJc9Ad"]',     // class name 2024 (pode mudar)
    'div[class*="WMbnJf"]',     // alternativa 2024
    'div[class*="bwjTce"]',     // alternativa observada
    'div.GHT2ce',               // classe legada
  ],

  // Elementos dentro de cada review
  REVIEW_AUTHOR:   '[class*="d4r55"], span.d4r55, a[href*="contrib"], [class*="AHe6Kc"]',
  REVIEW_RATING:   'span[aria-label*="estrela"], span[aria-label*="Avaliação"], span[role="img"][aria-label*="star"], span[aria-label*="star"]',
  REVIEW_DATE:     'span[class*="rsqaWe"], span[class*="xRkPPb"], span[class*="DU9Pgb"], span[class*="dehysf"]',
  REVIEW_TEXT:     'span[class*="wiI7pd"], span[class*="HPa7tc"], span[class*="MyEned"], div[class*="Jtu6Td"] span',
  REVIEW_MORE_BTN: [
    'button[aria-label*="Veja mais"]',
    'button[aria-label*="Ver mais"]',
    'button[aria-label*="See more"]',
    'button[aria-label*="see more"]',
  ],

  // Spinner de carregamento de novos reviews
  LOADING_INDICATOR: [
    'div[class*="qjESne"] img[src*="loading"]',
    '[role="progressbar"]',
  ],

  // Botões de consentimento/cookies do Google
  CONSENT_BUTTONS: [
    '#L2AGLb',
    'button[aria-label*="Aceitar tudo"]',
    'button[aria-label*="Accept all"]',
    'form[action*="consent"] button',
    'button[jsname="b3VHJd"]',
  ],
}
