import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseAdmin } from '../lib/supabase.js'
import { AI_CONFIG } from '../lib/ai-config.js'
import { logger } from '../lib/logger.js'

export interface KBSearchResult {
  docId: string
  title: string
  solutionSummary: string
  solutionSteps: Array<{ step: number; text: string; code?: string }>
  similarity: number
  confidenceScore: number
  resolutionCount: number
}

export class EmbeddingService {
  private genAI: GoogleGenerativeAI

  constructor() {
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY não definida.')
    }
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const model = this.genAI.getGenerativeModel({ model: AI_CONFIG.embeddingModel })
      const result = await model.embedContent({
        content: { parts: [{ text }], role: 'user' },
        outputDimensionality: 768
      } as any)
      return result.embedding.values
    } catch (error) {
      logger.error('Erro ao gerar embedding', { error })
      throw error
    }
  }

  async searchKnowledge(query: string, opts?: {
    threshold?: number   // default 0.65
    count?: number       // default 5
    categoryId?: string
  }): Promise<KBSearchResult[]> {
    try {
      const embedding = await this.generateEmbedding(query)
      
      const { data, error } = await supabaseAdmin.rpc('search_knowledge', {
        query_embedding: embedding,
        match_threshold: opts?.threshold ?? 0.65,
        match_count: opts?.count ?? 5,
        filter_category: opts?.categoryId || null
      })

      if (error) throw error

      return (data || []).map((r: any) => ({
        docId: r.doc_id,
        title: r.title,
        solutionSummary: r.solution_summary,
        solutionSteps: r.solution_steps,
        similarity: r.similarity,
        confidenceScore: r.confidence_score,
        resolutionCount: r.resolution_count
      }))
    } catch (error) {
      logger.error('Erro na busca semântica na KB', { error })
      return []
    }
  }

  async searchKnowledgeAllStatus(query: string, opts?: {
    threshold?: number   // default 0.65
    count?: number       // default 5
    categoryId?: string
  }): Promise<Array<KBSearchResult & { status: string }>> {
    try {
      const embedding = await this.generateEmbedding(query)
      
      const { data, error } = await supabaseAdmin.rpc('search_knowledge_all_status', {
        query_embedding: embedding,
        match_threshold: opts?.threshold ?? 0.65,
        match_count: opts?.count ?? 5,
        filter_category: opts?.categoryId || null
      })

      if (error) throw error

      return (data || []).map((r: any) => ({
        docId: r.doc_id,
        title: r.title,
        solutionSummary: r.solution_summary,
        solutionSteps: r.solution_steps,
        similarity: r.similarity,
        confidenceScore: r.confidence_score,
        resolutionCount: r.resolution_count,
        status: r.status
      }))
    } catch (error) {
      logger.error('Erro na busca semântica em todos os status na KB', { error })
      return []
    }
  }

  async upsertDocEmbedding(docId: string, content: string): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(content)
      
      // Deletar antigo se existir e inserir novo
      // Nota: o supabaseAdmin.from('support_knowledge_embeddings').upsert() com doc_id funcionaria se houvesse constraint unique
      // Mas o prompt sugere delete + insert por doc_id
      const { error: delError } = await supabaseAdmin
        .from('support_knowledge_embeddings')
        .delete()
        .eq('doc_id', docId)
      
      if (delError) throw delError

      const { error: insError } = await supabaseAdmin
        .from('support_knowledge_embeddings')
        .insert({
          doc_id: docId,
          content,
          embedding
        })

      if (insError) throw insError
      
      logger.info('Embedding de conhecimento atualizado', { docId })
    } catch (error) {
      logger.error('Erro ao atualizar embedding de documento', { docId, error })
      throw error
    }
  }
}

export const embeddingService = new EmbeddingService()
