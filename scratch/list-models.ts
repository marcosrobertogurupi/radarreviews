import 'dotenv/config'

async function listModels() {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('No API Key')
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  
  try {
    const res = await fetch(url)
    const data: any = await res.json()
    console.log('Available Models:')
    if (data.models) {
      data.models.forEach((m: any) => console.log(`- ${m.name} (${m.supportedGenerationMethods.join(', ')})`))
    } else {
      console.log('No models found or error:', data)
    }
  } catch (err) {
    console.error('Error listing models:', err)
  }
}

listModels()
