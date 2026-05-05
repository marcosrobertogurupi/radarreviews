import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'

async function testGemini() {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('No API Key')
  const genAI = new GoogleGenerativeAI(apiKey)
  
  try {
    console.log('Testing gemini-1.5-flash with v1...')
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }, { apiVersion: 'v1' })
    const result = await model.generateContent('Olá, diga Oi.')
    console.log(`✅ Success with gemini-1.5-flash (v1):`, result.response.text())
  } catch (err: any) {
    console.log(`❌ Failed with gemini-1.5-flash (v1):`, err.status, err.statusText, err.message)
  }

  try {
    console.log('Testing text-embedding-004 with v1...')
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' }, { apiVersion: 'v1' })
    const result = await model.embedContent('Hello world')
    console.log(`✅ Success with text-embedding-004 (v1):`, result.embedding.values.slice(0, 5), '...')
  } catch (err: any) {
    console.log(`❌ Failed with text-embedding-004 (v1):`, err.status, err.statusText, err.message)
  }
}

testGemini()
