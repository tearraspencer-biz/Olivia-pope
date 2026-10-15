import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import type { KnowledgeItem, KnowledgeType } from './knowledge.js'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 600_000,
})

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MODEL = 'claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS = 24576
// A ceiling, not a target. The first real run produced 26 items from one talk
// with a median content length of 664 characters — roughly half the depth of the
// meeting extractor's output. Splitting finely makes each lesson shallow, so the
// prompt below now pushes toward merging related points into fewer, fuller ones.
const MAX_ITEMS = 25
const TARGET_ITEMS = '8 to 18'
const MAX_TRANSCRIPT_WORDS = 150_000

export interface VideoData {
  title: string
  channel?: string | null
  url: string
  transcript: string
}

export interface VideoExtraction {
  overview: string
  items: KnowledgeItem[]
}

const VALID_TYPES: KnowledgeType[] = [
  'concept', 'explanation', 'worked_example', 'framework', 'faq', 'pitfall', 'tool_tip',
]

function truncate(text: string): string {
  const words = text.split(/\s+/)
  if (words.length <= MAX_TRANSCRIPT_WORDS) return text
  return words.slice(0, MAX_TRANSCRIPT_WORDS).join(' ') + '\n\n[Transcript truncated for processing.]'
}

/**
 * The shape Claude fills in, enforced by forcing a tool call rather than asking
 * for JSON in prose. Free-text JSON failed on a long sermon when a quote with
 * its own quotation marks went unescaped ("Unexpected token I in JSON at
 * position 31068") and the whole video was lost. Tool input is produced by the
 * API as structured data, so there is no hand-written JSON to break.
 */
const RECORD_TOOL: Anthropic.Tool = {
  name: 'record_video_lessons',
  description: 'Record the overview and the lessons extracted from the video.',
  input_schema: {
    type: 'object',
    properties: {
      overview: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            knowledge_type: { type: 'string', enum: [...VALID_TYPES] },
            summary: { type: 'string' },
            content: { type: 'string' },
            source_quote: { type: ['string', 'null'] },
            source_timestamp: { type: ['string', 'null'] },
            speaker: { type: ['string', 'null'] },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'knowledge_type', 'summary', 'content'],
        },
      },
    },
    required: ['overview', 'items'],
  },
}

function coerceItem(raw: any): KnowledgeItem | null {
  const title = typeof raw?.title === 'string' ? raw.title.trim() : ''
  const content = typeof raw?.content === 'string' ? raw.content.trim() : ''
  if (!title || !content) return null
  return {
    title,
    knowledge_type: VALID_TYPES.includes(raw?.knowledge_type) ? raw.knowledge_type : 'concept',
    summary: typeof raw?.summary === 'string' ? raw.summary.trim() : '',
    content,
    source_quote: typeof raw?.source_quote === 'string' ? raw.source_quote.trim() || null : null,
    speaker: typeof raw?.speaker === 'string' ? raw.speaker.trim() || null : null,
    source_timestamp:
      typeof raw?.source_timestamp === 'string' ? raw.source_timestamp.trim() || null : null,
    tags: Array.isArray(raw?.tags)
      ? raw.tags.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
      : [],
  }
}

/**
 * Extract what a video teaches.
 *
 * Deliberately a different prompt from the meeting extractor. A meeting is
 * Tearra's own conversation, so that prompt mines decisions and commitments.
 * A video is someone else teaching, so the job is the opposite: capture the
 * substance of the instruction well enough that she could teach it herself
 * without rewatching, and stay honest about what was actually said.
 */
export async function extractVideoKnowledge(video: VideoData): Promise<VideoExtraction> {
  const prompt = `You are Olivia Pope, intelligence advisor for Impactful Financial Solutions.

Tearra teaches AI skills at AI Junkies University. She watches videos from other
practitioners to learn, and she needs the substance extracted so she can apply it
and teach it without rewatching.

VIDEO: ${video.title}
${video.channel ? `CHANNEL: ${video.channel}` : ''}
URL: ${video.url}

TRANSCRIPT:
${truncate(video.transcript)}

Call record_video_lessons. What each field must contain:

{
  "overview": "3 to 5 sentences. What this video is actually about, what it teaches, and who it is useful for. Written for Tearra deciding whether to spend time on the full video.",
  "items": [
    {
      "title": "Short, specific name for one thing this video teaches. Say what it claims, not the topic. Bad: 'n8n workflows'. Good: 'Why you should split a long n8n workflow into sub-workflows before it hits 40 nodes'.",
      "knowledge_type": "One of: concept, explanation, worked_example, framework, faq, pitfall, tool_tip",
      "summary": "One sentence Tearra can scan in a list to decide whether to read the full item.",
      "content": "The actual teaching, in markdown, written as instruction to someone who has NOT seen the video — never 'as the video explains' or 'he mentions'. This is the field that matters; the summary above is only a label for it. It must stand alone as something Tearra could teach from without rewatching, which means covering, where the video provides them: WHAT the thing is, WHY it works or matters, HOW to actually do it step by step, the SPECIFICS given (exact numbers, timeframes, prices, tool names, settings, phrasings), any EXAMPLE the speaker used, and what to avoid. Aim for 250 to 500 words. If you cannot write at least 150 words of real substance about an item, it is too granular — merge it into a related item rather than shipping a thin one.",
      "source_quote": "The most relevant verbatim line or two from the transcript, so the claim can be checked before it is taught onward. null if no single line captures it.",
      "source_timestamp": "The timestamp on that line if the transcript has them, as HH:MM:SS or MM:SS. null if the transcript has no timestamps.",
      "speaker": "Who said it, if the transcript names speakers. null otherwise.",
      "tags": ["3 to 6 lowercase tags: tools, concepts, or skills involved"]
    }
  ]
}

Rules:
- Extract only what the video ACTUALLY teaches. Do not add your own knowledge of the subject, fill gaps, or correct the speaker. If they are wrong, capture what they said — accuracy about the source matters more than being right.
- Keep specifics. A tool version, a pricing number, a setting name, an exact prompt — those are the parts worth having and the first thing lost in a summary.
- Skip intros, sponsor reads, subscribe requests, and self-promotion.
- Skip anything that only makes sense with the video's visuals and cannot be written down.
- Depth beats coverage. ${TARGET_ITEMS} substantial items is the target for a typical talk; ${MAX_ITEMS} is the hard ceiling. Twenty-six one-paragraph items is a worse result than twelve that actually teach.
- Merge aggressively. If several points belong to one framework, phase, or method, make them ONE item that covers the whole thing with its steps — not one item per step. A four-phase framework is usually one item per phase at most, plus the framework itself.
- Never let content just restate the summary in more words. If they say the same thing, the item is not finished.
- Keep the speaker's own examples, analogies, and exact phrasing where they carry the point. Those are the first casualty of summarising and the reason to watch a specific person rather than read a generic article.
- If the video teaches nothing transferable, return an empty items array with an overview saying so.`

  // Streamed: a long video at 24k max_tokens exceeds a non-streaming request's
  // practical limit. See knowledge.ts for the history behind this.
  const response = await anthropic.messages
    .stream({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      tools: [RECORD_TOOL],
      tool_choice: { type: 'tool', name: RECORD_TOOL.name },
      messages: [{ role: 'user', content: prompt }],
    })
    .finalMessage()

  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!call) {
    throw new Error(
      `Video extraction returned no lessons (stop_reason: ${response.stop_reason}, ` +
        `blocks: ${response.content.map((b) => b.type).join(',') || 'none'})`
    )
  }
  const parsed = call.input as any
  const rawItems: unknown[] = Array.isArray(parsed?.items) ? parsed.items : []

  // Cut off at max_tokens, the stream still yields every item written so far,
  // but the last one stops mid-sentence. Drop it rather than save half a lesson.
  if (response.stop_reason === 'max_tokens' && rawItems.length > 0) {
    rawItems.pop()
    console.warn(`[Video] Response truncated; kept ${rawItems.length} complete item(s)`)
  }

  return {
    overview: typeof parsed?.overview === 'string' ? parsed.overview.trim() : '',
    items: rawItems.map(coerceItem).filter((i): i is KnowledgeItem => i !== null),
  }
}

export async function saveVideoKnowledge(
  videoId: string,
  items: KnowledgeItem[]
): Promise<number> {
  if (items.length === 0) return 0
  const rows = items.map((item) => ({
    ...item,
    video_id: videoId,
    source_type: 'video',
    // meeting_id stays null; a CHECK constraint enforces exactly one source.
  }))
  const { error } = await supabase.from('knowledge').insert(rows)
  if (error) throw new Error(`Video knowledge insert failed: ${error.message}`)
  return rows.length
}
