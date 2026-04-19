import { chromium } from 'playwright'
import 'dotenv/config'

async function inspectRA() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto('https://www.reclameaqui.com.br/empresa/unimed-palmas/lista-reclamacoes/', { waitUntil: 'networkidle' })
  
  const items = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('a[href*="/reclamacao/"]')).slice(0, 5)
    return cards.map(c => {
      const container = c.closest('div, li')
      const time = container?.querySelector('time, span[class*="date"], span[class*="Date"]')
      return {
        title: c.textContent?.trim(),
        href: (c as HTMLAnchorElement).href,
        dateText: time?.textContent?.trim(),
        dateTime: time?.getAttribute('datetime')
      }
    })
  })
  
  console.log(JSON.stringify(items, null, 2))
  await browser.close()
}

inspectRA()
