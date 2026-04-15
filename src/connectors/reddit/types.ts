export interface RedditPublicConfig {
  mode?: 'public' | 'oauth'
  search_terms?: string[]
  keywords?: string[]         // alias retrocompatível com search_terms
  subreddits?: string[]
  limit_per_request?: number
  delay_ms?: number
  since_days?: number
  time_filter?: string        // retrocompatível — mapeado para since_days
}

export interface RedditPost {
  id: string
  name: string
  title: string
  selftext: string
  author: string
  subreddit: string
  subreddit_name_prefixed: string
  score: number
  upvote_ratio: number
  num_comments: number
  created_utc: number
  permalink: string
  url: string
  is_self: boolean
  over_18: boolean
  stickied: boolean
}

export interface RedditListing {
  kind: 'Listing'
  data: {
    after: string | null
    before: string | null
    dist: number
    children: Array<{
      kind: 't3'
      data: RedditPost
    }>
  }
}

export interface RedditSyncResult {
  total_fetched: number
  total_inserted: number
  total_skipped: number
  errors: string[]
  pages_fetched: number
}
