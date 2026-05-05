import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'

async function checkDim() {
  const apiKey = process.env['GEMINI_API_KEY']
  const genAI = new GoogleGenerativeAI(apiKey!)
  try {
    const model = genAI.getGenerativeModel({ model: 'models/embedding-001' })
    const result = await model.embedContent('Hello')
    console.log('models/embedding-001 Dimension:', result.embedding.values.length)
  } catch(e) { console.log('models/embedding-001 failed') }
}

checkDim()
