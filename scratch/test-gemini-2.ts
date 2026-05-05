import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'

async function testGemini2() {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('No API Key')
  const genAI = new GoogleGenerativeAI(apiKey)
  
  try {
    console.log('Testing gemini-2.0-flash...')
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.0-flash' })
    const result = await model.generateContent('Olá, diga Oi.')
    console.log(`✅ Success with gemini-2.0-flash:`, result.response.text())
  } catch (err: any) {
    console.log(`❌ Failed with gemini-2.0-flash:`, err.status, err.statusText, err.message)
  }
}

testGemini2()
