import 'dotenv/config'

async function testSimpleFetch() {
  const apiKey = process.env['GEMINI_API_KEY']
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`
  
  const body = {
    contents: [{ parts: [{ text: "Oi" }] }]
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    console.log('Status:', res.status)
    console.log('Response:', JSON.stringify(data, null, 2))
  } catch (err) {
    console.error('Fetch error:', err)
  }
}

testSimpleFetch()
