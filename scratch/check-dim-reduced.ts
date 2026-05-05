import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'

async function checkDim() {
  const apiKey = process.env['GEMINI_API_KEY']
  const genAI = new GoogleGenerativeAI(apiKey!)
  try {
    const model = genAI.getGenerativeModel({ model: 'models/gemini-embedding-001' })
    const result = await model.embedContent({
      content: { parts: [{ text: 'Hello' }], role: 'user' },
      outputDimensionality: 768
    })
    console.log('768 Request Dimension:', result.embedding.values.length)
  } catch(e: any) { 
    console.log('768 Request failed:', e.message) 
  }
}

checkDim()
