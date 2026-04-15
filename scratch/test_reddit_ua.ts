import 'dotenv/config'

async function testReddit() {
  const url = 'https://www.reddit.com/search.json?q=Hotel+Copacabana&sort=new'
  
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Reputei/1.0 (contact: marcosroberto_gurupi@hotmail.com)'
  ]

  console.log(`--- TESTANDO REDDIT 403 ---`)
  
  for (const ua of userAgents) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': ua } })
      console.log(`UA: ${ua.slice(0, 30)}...`)
      console.log(`Status: ${resp.status} ${resp.statusText}`)
      if (resp.ok) {
        const json = await resp.json()
        console.log(`Sucesso! Encontrados ${json.data?.children?.length || 0} posts.`)
      }
      console.log('---')
    } catch (err) {
      console.error(`Erro:`, err)
    }
  }
}

testReddit()
