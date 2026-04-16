const SUPABASE_URL = 'https://lkwahbipteiqqzkmfrac.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxrd2FoYmlwdGVpcXF6a21mcmFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTkxMzgyNywiZXhwIjoyMDkxNDg5ODI3fQ.iYi2mcZUrV2zwmkiFB_Uk7S9jphwRSXVIQWbahrR_vg';

async function checkErrors() {
  console.log('--- BUSCANDO ERROS (DIRECT FETCH) ---');
  
  const query = `${SUPABASE_URL}/rest/v1/sync_jobs?select=*,channel_connectors(channel,external_id)&status=eq.failed&order=started_at.desc&limit=10`;
  
  try {
    const resp = await fetch(query, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    if (!resp.ok) {
        console.error('Falha na API:', resp.status, await resp.text());
        return;
    }

    const data = await resp.json();
    if (data.length === 0) {
      console.log('Nenhum erro encontrado.');
      return;
    }

    data.forEach(job => {
      const channel = job.channel_connectors?.channel;
      const id = job.channel_connectors?.external_id;
      console.log(`[${job.started_at}] ${channel} (${id})`);
      console.log(`ERRO: ${JSON.stringify(job.error_detail)}`);
      console.log('---');
    });
  } catch (err) {
    console.error('Erro de rede:', err);
  }
}

checkErrors();
