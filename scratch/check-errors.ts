import { supabase } from '../src/lib/supabase.js'
async function run() { 
  const { data, error } = await supabase.from('channel_connectors')
    .select('channel, external_id, status, error_message, monitored_businesses(name)')
    .in('status', ['error', 'pending_auth'])
    .order('updated_at', { ascending: false }); 
  console.log(JSON.stringify(data, null, 2)); 
  if (error) console.error(error)
} 
run();
