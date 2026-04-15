// Script para listar modelos disponíveis na API do Gemini
import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'

const apiKey = process.env['GEMINI_API_KEY']
if (!apiKey) { console.error('GEMINI_API_KEY não definida'); process.exit(1) }

const genAI = new GoogleGenerativeAI(apiKey)

// Usar fetch direto para listar modelos disponíveis
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
const data = await res.json() as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> }

if (!data.models) {
  console.error('Erro ao listar modelos:', data)
  process.exit(1)
}

console.log('\n📋 Modelos disponíveis que suportam generateContent:\n')
for (const model of data.models) {
  if (model.supportedGenerationMethods?.includes('generateContent')) {
    console.log(' ✅', model.name)
  }
}
console.log()
