import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 300_000,
})

const MODEL = 'claude-sonnet-4-6'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MeetingActionItem {
  action: string
  owner: string
  deadline: string | null
  priority: 'high' | 'medium' | 'low'
}

export interface MeetingFollowUp {
  action: string
  recipient: string
  urgency: 'immediate' | 'this_week' | 'this_month'
}

export interface MeetingIntelligence {
  overview: {
    meeting_type: string
    meeting_type_label: string
    purpose: string
    attendees_structured: string[]
    outcome_summary: string
  }
  decisions: string[]
  action_items: MeetingActionItem[]
  next_steps: string[]
  client_intel: {
    applicable: boolean
    situation: string
    needs: string[]
    concerns: string[]
    buying_signals: string[]
    objections: string[]
    timeline_signals: string
    budget_signals: string
  }
  ideas_and_opportunities: string[]
  follow_up_required: MeetingFollowUp[]
  meeting_outcome: {
    successful: boolean
    moved_forward: string[]
    unresolved: string[]
    overall_assessment: string
  }
}

export interface MeetingData {
  title: string
  date?: string | null
  duration?: string | number | null
  attendees?: string | null
  summary?: string | null
  action_items?: string | null
  transcript: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateTranscript(text: string): string {
  const words = text.split(/\s+/)
  if (words.length <= 12000) return text
  return words.slice(0, 12000).join(' ') + '\n\n[Transcript truncated at 12,000 words for processing. Full transcript stored in database.]'
}

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1) return text.slice(start, end + 1)
  return text.trim()
}

// ── Meeting intelligence structuring ─────────────────────────────────────────

export async function classifyAndStructureMeeting(
  data: MeetingData
): Promise<MeetingIntelligence> {
  const truncated = truncateTranscript(data.transcript)

  const prompt = `You are Olivia Pope — a sharp intelligence advisor for Impactful Financial Solutions, owned by Tearra, a health insurance agent and AI tech builder in Chattanooga, Tennessee.

You have received a Zoom meeting recording transcript processed by Fathom.
Your job is to classify this meeting, extract all intelligence, and structure it into a complete meeting intelligence record.

MEETING TITLE: ${data.title}
MEETING DATE: ${data.date ?? 'Not provided'}
DURATION: ${data.duration ?? 'Not provided'} minutes
ATTENDEES: ${data.attendees ?? 'Not provided'}

FATHOM SUMMARY:
${data.summary ?? 'Not provided'}

FATHOM ACTION ITEMS:
${data.action_items ?? 'Not provided'}

FULL TRANSCRIPT:
${truncated}

Tearra's business context:
- Impactful Health: health insurance agency — individual, small group, ICHRA, Medicare
- Impactful Tech: AI systems, automation, AI Bootcamps for health insurance agents
- Current clients: individuals, small businesses, health insurance agents
- Current focus: Medicare learning, ICHRA growth, AI Bootcamp building

MEETING TYPE CLASSIFICATION:
Classify this meeting as exactly one of:
- client_meeting: meeting with an existing or potential client about their coverage or needs
- sales_call: a prospecting or sales conversation with someone not yet a client
- strategy_session: internal planning, business strategy, or goal-setting meeting
- coaching_call: a coaching, mentorship, or advisory call where Tearra is being coached
- onboarding: a new client setup or onboarding meeting
- check_in: a brief update or follow-up call with an existing client or contact
- other: anything that does not fit the above

Return ONLY a valid JSON object. No preamble. No explanation. No markdown fences.
Use this exact structure:

{
  "overview": {
    "meeting_type": "one of the 6 types above",
    "meeting_type_label": "Human readable label e.g. Client Meeting",
    "purpose": "What this meeting was about in one clear sentence",
    "attendees_structured": ["Name 1", "Name 2"],
    "outcome_summary": "One sentence — what happened overall in this meeting"
  },
  "decisions": [
    "Every concrete decision made in this meeting. Empty array if none."
  ],
  "action_items": [
    {
      "action": "Specific task or commitment made",
      "owner": "Tearra, client name, or both",
      "deadline": "Specific date or timeframe mentioned, or null",
      "priority": "high, medium, or low based on context"
    }
  ],
  "next_steps": [
    "Next steps in chronological order. What happens next, then what."
  ],
  "client_intel": {
    "applicable": true,
    "situation": "What the client revealed about their current situation",
    "needs": ["Specific need 1", "Specific need 2"],
    "concerns": ["Concern or hesitation expressed"],
    "buying_signals": ["Positive signals toward moving forward"],
    "objections": ["Objections raised"],
    "timeline_signals": "What they said about when they want to move or make a decision",
    "budget_signals": "What they revealed about budget, cost sensitivity, or willingness to pay"
  },
  "ideas_and_opportunities": [
    "Any strategic idea, product idea, offer idea, content idea, or business opportunity that surfaced"
  ],
  "follow_up_required": [
    {
      "action": "Specific thing Tearra needs to do after this meeting",
      "recipient": "Who it is for — client name, contact, or internal",
      "urgency": "immediate, this_week, or this_month"
    }
  ],
  "meeting_outcome": {
    "successful": true,
    "moved_forward": ["What specifically advanced or was accomplished"],
    "unresolved": ["What is still open, unclear, or unresolved"],
    "overall_assessment": "2 to 3 sentences. Honest assessment of how this meeting went, what it means for the relationship or project, and what the most important thing to do next is."
  }
}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Meeting structuring returned no output')
  }

  const jsonText = extractJson(textBlock.text)
  return JSON.parse(jsonText) as MeetingIntelligence
}

// ── 8-layer business lens ─────────────────────────────────────────────────────

export async function generateBusinessLens(
  data: MeetingData,
  structured: MeetingIntelligence
): Promise<string> {
  const decisionsText =
    structured.decisions.length > 0
      ? structured.decisions.join('; ')
      : 'None recorded'

  const prompt = `You are Olivia Pope, intelligence advisor for Impactful Financial Solutions.

You have just processed a meeting and extracted the intelligence below.
Now apply the 8-layer business lens to this meeting — written in plain language for Tearra to read and act on immediately.

MEETING TITLE: ${data.title}
MEETING TYPE: ${structured.overview.meeting_type_label}
MEETING INTELLIGENCE SUMMARY:
- Purpose: ${structured.overview.purpose}
- Outcome: ${structured.overview.outcome_summary}
- Key decisions: ${decisionsText}
- Action items: ${structured.action_items.length} items
- Follow-up required: ${structured.follow_up_required.length} items

Write the 8-layer breakdown for this meeting:

WHAT IS THIS
[What was this meeting about? Who was involved? What was the core topic or goal? Plain language. 3 to 5 sentences.]

WHY DOES THIS MATTER RIGHT NOW
[Why does this meeting matter specifically for Tearra's business in 2026? What is at stake from this conversation? What could move forward or fall apart based on it? 3 to 5 sentences. Be specific.]

HOW DOES THIS HELP YOUR CLIENTS
[If this was a client meeting: what did you learn about how to serve this client better? If not a client meeting: what from this conversation could improve how you serve clients? 3 to 5 sentences.]

HOW DOES THIS HELP YOUR GROWTH
[What from this meeting — decisions made, ideas surfaced, relationships advanced — moves Impactful Health or Impactful Tech forward? 3 to 5 sentences. Be specific about which branch of the business.]

REVENUE OPPORTUNITY
[Is there a direct revenue opportunity from this meeting? A client close, an upsell, a referral, a new offer idea, a partnership angle? Be specific. If none, say so honestly.]

CONTENT ANGLE
[What content could this meeting inspire? Name the format, audience, and what the content would say. One specific idea based on what was discussed.]

ACTION SIGNAL
[One specific action Tearra should take based on this meeting. The single most important move. Today or this week. Be direct.]

AGENT BRIEFING LINE
[MEETING: ${data.title} | TYPE: ${structured.overview.meeting_type_label} | KEY OUTCOME: ${structured.overview.outcome_summary} | RELEVANCE: [Impactful Health or Impactful Tech or both] | AGENT ACTION: [what a content, sales, or CRM agent should do with this]]`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Business lens generation returned no output')
  }

  return textBlock.text
}
