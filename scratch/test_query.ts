// Test another suspected API URL health endpoint
try {
  const res = await fetch('https://api-production-24e1.up.railway.app/health');
  const body = await res.json();
  console.log('Status code:', res.status);
  console.log('Body:', body);
} catch (e) {
  console.error('Fetch failed:', e.message);
}
