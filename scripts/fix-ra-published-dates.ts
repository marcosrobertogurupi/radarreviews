import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
import { chromium } from 'playwright-core'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

async function main() {
  console.log('🔍 Buscando reviews do Reclame Aqui com conectores...')

  const { data: reviews } = await supabase
    .from('reviews')
    .select('id, external_id, title, url, connector_id, raw_data')
    .eq('channel', 'reclame_aqui')

  const { data: connectors } = await supabase
    .from('channel_connectors')
    .select('id, external_id')
    .eq('channel', 'reclame_aqui')

  const connMap = new Map((connectors || []).map(c => [c.id, c.external_id]))

  if (!reviews || reviews.length === 0) {
    console.log('Nenhum review do Reclame Aqui encontrado no banco.')
    return
  }

  console.log(`Encontrados ${reviews.length} reviews. Iniciando Chromium para buscar datas reais...`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'pt-BR',
  })
  const page = await context.newPage()

  for (const r of reviews) {
    const companySlug = connMap.get(r.connector_id) || 'fiat'
    let targetUrl = r.url

    // Se o URL não contiver o slug correto no path, construir URL canônica do Reclame Aqui
    if (!targetUrl.includes(`/empresa/${companySlug}/`) && !targetUrl.includes(`/${companySlug}/`)) {
      targetUrl = `https://www.reclameaqui.com.br/${companySlug}/${r.external_id}/`
    }

    console.log(`\n--------------------------------------------------`)
    console.log(`📌 Review: "${r.title.slice(0, 50)}" (ID: ${r.id})`)
    console.log(`   URL Alvo: ${targetUrl}`)

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(2000)

      const pageData = await page.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__')
        if (el) {
          try {
            const data = JSON.parse(el.textContent ?? '')
            const pp = data?.props?.pageProps
            const c = pp?.complaint ?? pp?.initialData?.complaint ?? pp?.initialData?.complaintData ?? pp?.initialState?.complaint
            if (c) {
              const createdDate = c.created ?? c.createdDate ?? c.date ?? c.createdAt ?? c.legacyComplaint?.created ?? c.legacyComplaint?.createdDate
              if (createdDate) {
                return { date: String(createdDate) }
              }
            }
          } catch {}
        }

        let timeVal = document.querySelector('time[datetime]')?.getAttribute('datetime') ?? null
        if (!timeVal) {
          const allEls = Array.from(document.querySelectorAll('span, p, div, time, small'))
          for (const item of allEls) {
            const txt = item.textContent?.trim() ?? ''
            if (/(\d{2}\/\d{2}\/\d{2,4})|(há\s+\d+)/i.test(txt) && txt.length < 60) {
              timeVal = item.getAttribute('datetime') ?? txt
              break
            }
          }
        }

        return { date: timeVal }
      })

      if (pageData?.date) {
        let isoDate: string | null = null
        try {
          const d = new Date(pageData.date)
          if (!isNaN(d.getTime())) isoDate = d.toISOString()
        } catch {}

        if (!isoDate) {
          const brMatch = pageData.date.match(/(\d{2})\/(\d{2})\/(\d{2,4})[^\d]*(\d{2}):(\d{2})/)
          if (brMatch) {
            const [, day, month, yearStr, hour, min] = brMatch
            const year = yearStr.length === 2 ? `20${yearStr}` : yearStr
            isoDate = new Date(`${year}-${month}-${day}T${hour}:${min}:00-03:00`).toISOString()
          }
        }

        if (isoDate) {
          console.log(`✅ Data real encontrada: ${pageData.date} -> ISO: ${isoDate}`)

          const updatedRawData = {
            ...(r.raw_data as Record<string, unknown>),
            date: pageData.date,
            created: isoDate,
          }

          const { error: updateErr } = await supabase
            .from('reviews')
            .update({
              published_at: isoDate,
              url: targetUrl,
              raw_data: updatedRawData,
            })
            .eq('id', r.id)

          if (updateErr) {
            console.error(`❌ Erro ao atualizar no banco:`, updateErr)
          } else {
            console.log(`🎉 Review ${r.id} atualizado com sucesso no Supabase!`)
          }
        } else {
          console.log(`⚠️ Não foi possível converter a data "${pageData.date}" para ISO.`)
        }
      } else {
        console.log(`⚠️ Nenhuma data encontrada na página.`)
      }
    } catch (err) {
      console.error(`❌ Erro ao processar URL ${targetUrl}:`, err)
    }
  }

  await browser.close()
  console.log('\n✨ Concluído!')
}

main().catch(console.error)
