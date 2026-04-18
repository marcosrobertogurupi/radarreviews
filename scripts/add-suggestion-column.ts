import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'
import { logger } from '../src/lib/logger.js'

async function migrate() {
  logger.info('Adicionando coluna sentiment_suggestion à tabela reviews...')
  
  // Como o Supabase JS SDK não permite ALTER TABLE direto via rpc ou query fácil sem função definida,
  // vamos tentar via rpc se houver uma função de exec_sql, ou apenas avisar o usuário.
  // No entanto, em muitos projetos de automação, temos uma função rpc('exec_sql', { sql: '...' }).
  
  const { error } = await supabase.rpc('exec_sql', {
    sql: 'ALTER TABLE reviews ADD COLUMN IF NOT EXISTS sentiment_suggestion TEXT;'
  })

  if (error) {
    logger.error('Falha ao adicionar coluna via RPC:', error)
    logger.info('Por favor, execute este SQL manualmente no painel do Supabase:')
    console.log('ALTER TABLE reviews ADD COLUMN IF NOT EXISTS sentiment_suggestion TEXT;')
  } else {
    logger.info('Coluna adicionada com sucesso!')
  }
}

migrate()
