const SUPABASE_URL = 'https://lkwahbipteiqqzkmfrac.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxrd2FoYmlwdGVpcXF6a21mcmFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTkxMzgyNywiZXhwIjoyMDkxNDg5ODI3fQ.iYi2mcZUrV2zwmkiFB_Uk7S9jphwRSXVIQWbahrR_vg';

async function checkErrors() {
  console.log('--- BUSCANDO ERROS REDDIT ---');
  
  const query = `${SUPABASE_URL}/rest/v1/sync_jobs?select=*,channel_connectors(channel,external_id)&status=eq.failed&channel_connectors.channel=eq.reddit&order=started_at.desc&limit=5`;
  
  try {
    const resp = await fetch(query, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    const data = await resp.json();
    data.forEach(job => {
      console.log(`[${job.started_at}] REDDIT (${job.channel_connectors.external_id})`);
      console.log(`ERRO: ${JSON.stringify(job.error_detail)}`);
      console.log('---');
    });
  } catch (err) {
    console.error('Erro:', err);
  }
}

checkErrors();
