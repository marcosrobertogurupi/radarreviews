import 'dotenv/config'

async function checkAuth(login: string, pass: string) {
  const auth = Buffer.from(`${login}:${pass}`).toString('base64');
  console.log(`Testing with ${login}... (Base64: ${auth})`);
  
  const res = await fetch('https://api.dataforseo.com/v3/business_data/tripadvisor/search/task_post', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{
      keyword: "Hotel Unique São Paulo",
      language_code: "pt",
      limit: 1
    }])
  });
  
  const data = await res.json();
  console.log(`Status: ${res.status}`);
  console.log(`Response:`, JSON.stringify(data, null, 2));
  return res.status === 200;
}

async function run() {
  const pass = '915c4f03d5029b16';
  
  console.log('--- Option 1: nestservicesoftware ---');
  await checkAuth('nestservicesoftware@gmail.com', pass);
  
  console.log('\n--- Option 2: netservicesoftware ---');
  await checkAuth('netservicesoftware@gmail.com', pass);
}

run();
