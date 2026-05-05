import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'

async function testEmbedding() {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('No API Key')
  const genAI = new GoogleGenerativeAI(apiKey)
  
  const models = ['text-embedding-004', 'models/text-embedding-004', 'embedding-001']
  
  for (const m of models) {
    console.log(`Testing model: ${m}...`)
    try {
      const model = genAI.getGenerativeModel({ model: m })
      const result = await model.embedContent('Hello world')
      console.log(`✅ Success with ${m}:`, result.embedding.values.slice(0, 5), '...')
      return
    } catch (err: any) {
      console.log(`❌ Failed with ${m}:`, err.status, err.statusText)
    }
  }
}

testEmbedding()
