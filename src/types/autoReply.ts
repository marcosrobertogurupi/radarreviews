import { z } from 'zod'
import type { SourceChannel } from './review.js'

export type AutoReplyMode = 'autopilot' | 'copilot' | 'hybrid'

export interface AutoReplySettings {
  enabled: boolean
  mode: AutoReplyMode
  signature: string
  tone_of_voice: string
  mention_staff_names: boolean
  auto_publish_min_rating: number
  custom_rules?: string
  channels: SourceChannel[]
}

export const AutoReplySettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['autopilot', 'copilot', 'hybrid']),
  signature: z.string().min(2),
  tone_of_voice: z.string().min(2),
  mention_staff_names: z.boolean(),
  auto_publish_min_rating: z.number().min(1).max(5),
  custom_rules: z.string().optional(),
  channels: z.array(z.string() as z.ZodType<SourceChannel>),
})

export type ReviewResponseStatus =
  | 'none'
  | 'draft'
  | 'pending_approval'
  | 'publishing'
  | 'published'
  | 'failed'

export interface ReviewReplyExample {
  id: string
  tenant_id: string
  business_id?: string
  review_id?: string
  channel: SourceChannel
  rating?: number
  review_text: string
  user_approved_text: string
  was_edited_by_user: boolean
  created_at: string
}

export interface GeneratedReplyResult {
  reply_text: string
  confidence: number
  reasoning?: string
  examples_used_count: number
  mentioned_staff?: string[]
}
