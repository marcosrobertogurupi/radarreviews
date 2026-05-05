import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'

async function testGemini() {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('No API Key')
  const genAI = new GoogleGenerativeAI(apiKey)
  
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
    const result = await model.generateContent('Olá, diga Oi.')
    console.log(`✅ Success with gemini-1.5-flash:`, result.response.text())
  } catch (err: any) {
    console.log(`❌ Failed with gemini-1.5-flash:`, err.status, err.statusText, err.message)
  }
}

testGemini()
