import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'

async function checkDim() {
  const apiKey = process.env['GEMINI_API_KEY']
  const genAI = new GoogleGenerativeAI(apiKey!)
  const model = genAI.getGenerativeModel({ model: 'models/gemini-embedding-001' })
  const result = await model.embedContent('Hello')
  console.log('Dimension:', result.embedding.values.length)
}

checkDim()
