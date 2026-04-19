import { chromium } from 'playwright'
import 'dotenv/config'

async function debugRA() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  })
  const page = await context.newPage()
  
  const url = 'https://www.reclameaqui.com.br/empresa/unimed-palmas/lista-reclamacoes/'
  console.log(`📡 Lendo ${url}...`)
  
  await page.goto(url, { waitUntil: 'networkidle' })
  
  const data = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script'))
    const nextScript = scripts.find(s => s.id === '__NEXT_DATA__')
    if (!nextScript) return 'Script __NEXT_DATA__ não encontrado'
    
    try {
      const json = JSON.parse(nextScript.textContent || '{}')
      const pp = json.props?.pageProps
      const complaints = pp?.complaints?.LAST || pp?.complaints || pp?.initialData?.complaintList?.complaints
      return complaints ? complaints.slice(0, 2) : 'Reclamações não encontradas no JSON'
    } catch (e) {
      return 'Erro ao parsear JSON: ' + (e instanceof Error ? e.message : String(e))
    }
  })
  
  console.log('Resultado:', JSON.stringify(data, null, 2))
  await browser.close()
}

debugRA()
