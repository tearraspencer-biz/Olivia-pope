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

// A 3.5-hour coaching call ("Coach AIJ Thurs Call 7/16/26", ~38,000 words)
// generated enough material to blow past the original 8,192 ceiling, so the JSON
// came back truncated and the whole batch was lost.
//
// Two controls, because raising the ceiling alone just moves the cliff:
// MAX_ITEMS bounds how much the model tries to emit, and MAX_OUTPUT_TOKENS
// leaves generous headroom above that bound. Sonnet 4.6 can emit far more than
// this, but staying at 16k keeps the request safely non-streaming — larger
// non-streaming responses risk HTTP timeouts.
// Raised from 25. A 271-minute call (51,000 words) returned exactly 25 items —
// hitting the cap precisely, which means the limit was the constraint rather
// than the material running out.
const MAX_ITEMS = 40

// Raised from 16,384 to stay ahead of MAX_ITEMS. Observed items run ~450 tokens
// each as JSON, so 40 items is ~18,000 — the old ceiling would have forced the
// salvage path on every long call instead of keeping it as a backstop.
const MAX_OUTPUT_TOKENS = 24576

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

/**
 * Recover the complete objects from a JSON array that was cut off mid-write.
 *
 * Walks back from the end to the last `}` that closes a top-level element, then
 * closes the array there. Returns null if not even one whole object survived.
 */
function salvageTruncatedArray(text: string): unknown[] | null {
  let depth = 0
  let inString = false
  let escaped = false
  let lastComplete = -1

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      // depth 0 here means this brace closed a direct element of the array.
      if (depth === 0) lastComplete = i
    }
  }

  if (lastComplete === -1) return null
  try {
    return JSON.parse(text.slice(0, lastComplete + 1) + ']')
  } catch {
    return null
  }
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
- Return at most ${MAX_ITEMS} items. A long call can contain more than that; if so, keep the most substantial and skip the rest rather than trying to cover everything thinly.
- If this meeting contains no teachable material, return exactly: []`

  // Streamed rather than a plain create(): at 24k max_tokens a non-streaming
  // request can exceed the HTTP timeout on a long call and fail after minutes
  // of work. Streaming holds the connection open; get_final_message reassembles
  // the whole response, so nothing downstream changes.
  const response = await anthropic.messages
    .stream({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
    .finalMessage()

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Knowledge extraction returned no output')
  }

  const raw = extractJson(textBlock.text)
  const truncated = response.stop_reason === 'max_tokens'

  // A truncated response is still mostly valid — it's a complete list of items
  // followed by one half-written object. Discarding all of them (the original
  // behaviour) lost 20+ good items to one incomplete one, so salvage instead.
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    if (!truncated) throw err
    const salvaged = salvageTruncatedArray(raw)
    if (!salvaged) {
      throw new Error('Knowledge extraction was truncated and nothing could be salvaged')
    }
    console.warn(
      `[Knowledge] Response truncated at max_tokens; salvaged ${salvaged.length} complete item(s)`
    )
    parsed = salvaged
  }

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
