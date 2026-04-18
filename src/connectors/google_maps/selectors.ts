export const GMAPS_SELECTORS = {
  // Botão de avaliações na página principal do local
  REVIEWS_TAB: [
    'button[aria-label*="avaliações"]',
    'button[aria-label*="Avaliações"]',
    '[role="tab"][aria-label*="Avaliações"]',
    'button:has-text("Avaliações")',
    'button:has-text("Reviews")',
  ],

  // Painel lateral de reviews (elemento scrollável)
  REVIEWS_PANEL: [
    'div.m6QErb[aria-label*="Avaliações"]',
    'div.m6QErb[aria-label*="Reviews"]',
    'div[role="main"] div[tabindex="-1"]',
    'div[aria-label*="Avaliações para"]',
  ],

  // Botão de ordenação
  SORT_BUTTON: [
    'button[aria-label*="Classificar avaliações"]',
    'button[aria-label*="Classificar"]',
    'button[aria-label*="Sort reviews"]',
    'button[data-value="sort"]',
  ],

  // Opção "Mais recentes" no dropdown de ordenação
  SORT_NEWEST: [
    '[role="menuitemradio"][aria-label*="Mais recentes"]',
    '[role="menuitem"][aria-label*="Mais recentes"]',
    '[role="menuitemradio"][aria-label*="Newest"]',
    '[role="menuitemradio"]:nth-child(2)',
  ],

  // Container de cada review individual
  REVIEW_ITEM: [
    'div[data-review-id]',
    'div[class*="jftiEf"]',
    'div.GHT2ce',
  ],

  // Elementos dentro de cada review
  REVIEW_AUTHOR:     '[class*="d4r55"], [class*="AHe6Kc"], [aria-label*="review by"]',
  REVIEW_RATING:     'span[aria-label*="estrela"], span[aria-label*="star"]',
  REVIEW_DATE:       'span[class*="rsqaWe"], span[class*="xRkPPb"]',
  REVIEW_TEXT:       'span[class*="wiI7pd"], span[class*="HPa7tc"]',
  REVIEW_MORE_BTN:   'button[aria-label*="Veja mais"], button[aria-label*="Ver mais"], button[aria-label*="See more"]',

  // Indicador de loading de novos reviews
  LOADING_INDICATOR: 'div[class*="qjESne"] img[src*="loading"]',

  // Botões de consentimento/cookies
  CONSENT_BUTTONS: [
    '#L2AGLb',
    'button[aria-label*="Aceitar tudo"]',
    'button[aria-label*="Accept all"]',
    'form[action*="consent"] button',
  ],
}
