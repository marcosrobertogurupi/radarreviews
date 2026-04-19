import { chromium } from 'playwright'
import 'dotenv/config'


async function dumpNextData() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  
  const slug = 'unimed-palmas' // Exemplo do log anterior
  const url = `https://www.reclameaqui.com.br/empresa/${slug}/lista-reclamacoes/`
  
  console.log(`📡 Acessando ${url}...`)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  
  const nextData = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__')
    return el ? JSON.parse(el.textContent!) : null
  })
  
  if (nextData) {
    // Salvar num arquivo para análise
    const fs = await import('node:fs')
    fs.writeFileSync('next-data-dump.json', JSON.stringify(nextData, null, 2))
    console.log('✅ __NEXT_DATA__ salvo em next-data-dump.json')
    
    // Tentar localizar a data
    const pp = nextData.props?.pageProps
    const complaints = pp?.complaints?.LAST || pp?.complaints || pp?.initialData?.complaintList?.complaints
    if (complaints && complaints.length > 0) {
      console.log('Exemplo de reclamação no NextData:')
      console.log(JSON.stringify(complaints[0], null, 2))
    }
  } else {
    console.log('❌ __NEXT_DATA__ não encontrado.')
  }
  
  await browser.close()
}

dumpNextData()
