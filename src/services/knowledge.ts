import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import type { MeetingData } from './meeting-intel.js'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 300_000,
})

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MODEL = 'claude-sonnet-4-6'

// ── Types ─────────────────────────────────────────────────────────────────────

export type KnowledgeType =
  | 'concept'
  | 'explanation'
  | 'worked_example'
  | 'framework'
  | 'faq'
  | 'pitfall'
  | 'tool_tip'

export interface KnowledgeItem {
  title: string
  knowledge_type: KnowledgeType
  summary: string
  content: string
  source_quote: string | null
  speaker: string | null
  source_timestamp: string | null
  tags: string[]
}

// Must match the CHECK constraint on knowledge.knowledge_type. Anything outside
// this set would be rejected by Postgres and lose the whole batch, so unknown
// values are coerced to 'concept' rather than sent.
const VALID_TYPES: KnowledgeType[] = [
  'concept',
  'explanation',
  'worked_example',
  'framework',
  'faq',
  'pitfall',
  'tool_tip',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start !== -1 && end !== -1) return text.slice(start, end + 1)
  return text.trim()
}

function coerceItem(raw: any): KnowledgeItem | null {
  const title = typeof raw?.title === 'string' ? raw.title.trim() : ''
  const content = typeof raw?.content === 'string' ? raw.content.trim() : ''
  if (!title || !content) return null

  const type: KnowledgeType = VALID_TYPES.includes(raw?.knowledge_type)
    ? raw.knowledge_type
    : 'concept'

  return {
    title,
    knowledge_type: type,
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

// ── Extraction ────────────────────────────────────────────────────────────────

/**
 * Pull reusable teaching material out of a meeting transcript.
 *
 * Returns [] for meetings that contain no teaching — most don't, and inventing
 * lessons from a status call would fill the library with noise that makes the
 * genuinely useful entries harder to find.
 */
export async function extractKnowledge(data: MeetingData): Promise<KnowledgeItem[]> {
  const prompt = `You are Olivia Pope, intelligence advisor for Impactful Financial Solutions.

Tearra runs AI Junkies University — a community teaching AI skills through five rooms:
AI Basics (the prerequisite floor), plus four specialized rooms covering content creation,
marketing, vibe coding, and agent building. Members work toward a shipped artifact in each room.

Your job: read this meeting transcript and extract the TEACHABLE KNOWLEDGE in it — the
things Tearra or another participant explained, demonstrated, corrected, or worked through
that would be worth teaching to a member who was not on this call.

MEETING TITLE: ${data.title}
${data.date ? `DATE: ${data.date}` : ''}
${data.attendees ? `ATTENDEES: ${data.attendees}` : ''}

TRANSCRIPT:
${data.transcript}

Extract each distinct piece of knowledge as its own item. An item must stand on its own —
a member should be able to read it without having heard the call or knowing who was there.

Return ONLY a JSON array. No preamble, no commentary. Each element:

{
  "title": "Short, specific name for this piece of knowledge. Not a topic label — say what it actually claims. Bad: 'Voice agents'. Good: 'Why VAPI needs a webhook fallback for end-of-call reports'.",
  "knowledge_type": "One of: concept, explanation, worked_example, framework, faq, pitfall, tool_tip",
  "summary": "One sentence a member could scan in a list to decide whether to read the full item.",
  "content": "The actual teaching material, in markdown. Write it as instruction to a member, not as a recap of the meeting. Never write 'as discussed on the call' or name the meeting — the member was not there. Include the reasoning, not just the conclusion. 2 to 6 paragraphs, or a list where a list is genuinely clearer.",
  "source_quote": "The most relevant verbatim line or two from the transcript that this came from, so Tearra can verify it before teaching it. Copy exactly. null if no single line captures it.",
  "speaker": "Who said it, exactly as their name appears in the transcript. null if unclear.",
  "source_timestamp": "The [HH:MM:SS] timestamp on the line, if the transcript has one. null otherwise.",
  "tags": ["3 to 6 lowercase tags: tools, concepts, or skills involved. Use the same tag for the same idea across items so the library stays filterable."]
}

Type definitions:
- concept: an idea or definition a member needs to understand
- explanation: how or why something works
- worked_example: a concrete walkthrough of doing something specific
- framework: a repeatable process, checklist, or method
- faq: a question someone asked that got a useful answer
- pitfall: a mistake, anti-pattern, or trap to avoid
- tool_tip: practical usage detail for a specific tool

Rules:
- Extract only what was ACTUALLY taught, explained, or demonstrated. Do not invent, extrapolate, or fill gaps with your own knowledge of the subject.
- Skip scheduling, small talk, status updates, and administrative back-and-forth.
- Skip anything that is purely about one person's specific situation and would not transfer to another member.
- Prefer fewer, more substantial items over many thin ones. An item that only restates its own title is not worth extracting.
- If this meeting contains no teachable material, return exactly: []`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Knowledge extraction returned no output')
  }

  if (response.stop_reason === 'max_tokens') {
    // Partial JSON can't be parsed and half a library is worse than none.
    throw new Error('Knowledge extraction hit max_tokens and returned truncated JSON')
  }

  const parsed = JSON.parse(extractJson(textBlock.text))
  if (!Array.isArray(parsed)) {
    throw new Error('Knowledge extraction did not return an array')
  }

  return parsed
    .map(coerceItem)
    .filter((item): item is KnowledgeItem => item !== null)
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function saveKnowledge(
  meetingId: string,
  items: KnowledgeItem[]
): Promise<number> {
  if (items.length === 0) return 0

  const rows = items.map((item) => ({ ...item, meeting_id: meetingId }))
  const { error } = await supabase.from('knowledge').insert(rows)

  if (error) {
    throw new Error(`Knowledge insert failed: ${error.message}`)
  }
  return rows.length
}
