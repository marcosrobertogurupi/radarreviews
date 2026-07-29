import { chromium } from 'playwright-core'
import fs from 'fs'

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--lang=pt-BR',
]

async function inspectPages() {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS })

  // 1. Inspect TripAdvisor
  console.log('\n--- INSPECCIONANDO TRIPADVISOR ---')
  const pageTa = await browser.newPage()
  await pageTa.goto('https://www.tripadvisor.com.br/Hotel_Review-g303324-d306098-Reviews-Comfort_Suites_Flamboyant-Goiania_State_of_Goias.html', { waitUntil: 'domcontentloaded' })
  await pageTa.waitForTimeout(4000)
  
  const titleTa = await pageTa.title()
  console.log('TripAdvisor Page Title:', titleTa)
  
  const jsonLdCount = await pageTa.evaluate(() => {
    return document.querySelectorAll('script[type="application/ld+json"]').length
  })
  console.log('TripAdvisor JSON-LD scripts count:', jsonLdCount)

  const reviewCardsCount = await pageTa.evaluate(() => {
    return document.querySelectorAll('[data-reviewid], [data-automation="reviewCard"], div[class*="review"], section[class*="review"]').length
  })
  console.log('TripAdvisor Review elements count:', reviewCardsCount)

  const bodySnippetTa = await pageTa.evaluate(() => document.body.innerText.slice(0, 500))
  console.log('TripAdvisor Body Snippet:\n', bodySnippetTa)

  // 2. Inspect Google Maps
  console.log('\n--- INSPECCIONANDO GOOGLE MAPS ---')
  const pageGmaps = await browser.newPage()
  const gmapsUrl = 'https://www.google.com/maps/place/?q=place_id:ChIJf3uB4w7xXpMRqNOozuqxhw8&hl=pt-BR'
  await pageGmaps.goto(gmapsUrl, { waitUntil: 'networkidle' }).catch(() => null)
  await pageGmaps.waitForTimeout(5000)

  const titleGmaps = await pageGmaps.title()
  console.log('Google Maps Title:', titleGmaps)

  const reviewItemsCount = await pageGmaps.evaluate(() => {
    return document.querySelectorAll('div[data-review-id], div[class*="jJc9Ad"], div[class*="WMbnJf"], div[class*="bwjTce"], div.GHT2ce').length
  })
  console.log('Google Maps Review items count:', reviewItemsCount)

  const buttonsText = await pageGmaps.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="tab"]')).map(b => b.textContent?.trim()).filter(Boolean).slice(0, 20)
  })
  console.log('Google Maps Buttons/Tabs snippet:', buttonsText)

  await browser.close()
}

inspectPages().catch(console.error)
