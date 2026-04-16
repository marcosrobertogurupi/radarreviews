const SUPABASE_URL = 'https://lkwahbipteiqqzkmfrac.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxrd2FoYmlwdGVpcXF6a21mcmFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTkxMzgyNywiZXhwIjoyMDkxNDg5ODI3fQ.iYi2mcZUrV2zwmkiFB_Uk7S9jphwRSXVIQWbahrR_vg';

async function checkReddit() {
  const query = `${SUPABASE_URL}/rest/v1/sync_jobs?select=*,channel_connectors(channel)&status=eq.failed&order=started_at.desc&limit=50`;
  const resp = await fetch(query, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } });
  const data = await resp.json();
  data.forEach(j => {
    if (j.channel_connectors && j.channel_connectors.channel === 'reddit') {
       console.log(`[${j.started_at}] REDDIT ERR: ${j.error_detail?.message || JSON.stringify(j.error_detail)}`);
    }
  });
}
checkReddit();
