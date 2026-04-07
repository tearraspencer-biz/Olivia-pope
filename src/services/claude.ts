import Anthropic from '@anthropic-ai/sdk'
import { OLIVIA_SYSTEM_PROMPT } from '../prompts/system.js'
import type { CategoryRecord, ProjectRecord } from '../cache.js'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 300_000, // 5 minutes — research calls can take 90+ seconds
})

const MODEL = 'claude-sonnet-4-6'

export interface StructuredResearch {
  task_title: string
  output_title: string
  summary: string
  full_text: string
  source_notes: string
  category_id: string
  project_id: string | null
  tags: string[]
  plain_language_breakdown?: string
}

// Step 1: Run full research on the topic
export async function runResearch(topic: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: OLIVIA_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Research this thoroughly and deliver complete findings: ${topic}`,
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Research run returned no output')
  }
  return textBlock.text
}

// Step 2: Structure the research output into a DB-ready JSON object with 8-layer breakdown
export async function structureResearch(
  topic: string,
  researchOutput: string,
  categories: CategoryRecord[],
  projects: ProjectRecord[]
): Promise<StructuredResearch> {
  const categoryList = categories.map((c) => `- ${c.name} (id: ${c.id})`).join('\n')
  const projectList = projects.map((p) => `- ${p.name} (id: ${p.id})`).join('\n')

  // Truncate research output to ~8000 words to stay within token limits
  const truncatedOutput = researchOutput.slice(0, 40000)

  const structuringPrompt = `You are Olivia Pope — a sharp, premium research and intelligence advisor for Impactful Financial Solutions, a health insurance and AI tech business owned by Tearra, a founder and strategic operator based in Chattanooga, Tennessee.

Your job is to take raw research output and structure it into a complete, organized intelligence record with two distinct layers:

Layer 1 — Structured metadata for database storage and agent retrieval
Layer 2 — A plain language business intelligence breakdown for Tearra

Tearra's business context:
- Impactful Health: health insurance agency — individual, small group, ICHRA, Medicare
- Impactful Tech: AI systems, automation, and agent-based tools for small businesses
- Current focus: learning Medicare fast, growing ICHRA book, building AI Bootcamps
- Location: Chattanooga, Tennessee
- Revenue target: $7,000–$8,000/month
- Primary clients: individuals, small business owners, health insurance agents

RESEARCH TOPIC (original request):
${topic}

RAW RESEARCH OUTPUT:
${truncatedOutput}

AVAILABLE CATEGORIES (select exactly one — use the exact id):
${categoryList}

AVAILABLE PROJECTS (select one or null — use the exact id):
${projectList}

---

Return ONLY a valid JSON object. No preamble. No explanation. No markdown fences.
Use this exact structure:

{
  "task_title": "Short descriptive title for the research task. Max 80 characters.",

  "output_title": "Full descriptive title for the research output. Max 120 characters.",

  "summary": "2 to 5 sentences. Written for agent retrieval — clear, specific, informative. Describes what this research covers and why it matters. Not plain language — this is for machine reading. Max 500 characters.",

  "full_text": "The complete research output fully preserved. Do not truncate or summarize.",

  "source_notes": "Any sources, links, or references cited. Empty string if none.",

  "category_id": "exact uuid of the most relevant category",

  "project_id": "exact uuid of the most relevant project or null if unclear",

  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],

  "plain_language_breakdown": "WHAT IS THIS\\n[Explain this topic like you are talking to a smart 12-year-old who has never heard of it. Use simple words. No jargon. No acronyms without explaining them first. 3 to 5 sentences maximum. Make it so clear that anyone could understand it in 30 seconds.]\\n\\nWHY DOES THIS MATTER RIGHT NOW\\n[Explain why this is relevant specifically in 2026, specifically for a health insurance and AI tech business in Chattanooga, Tennessee. What is changing, what is at stake, what is the timing. 3 to 5 sentences. Be specific — not generic.]\\n\\nHOW DOES THIS HELP YOUR CLIENTS\\n[Explain what this means for Tearra's clients — individuals buying health insurance, small business owners, people approaching Medicare age. What do they need to know about this? How does this affect them? What question does this answer for them? 3 to 5 sentences.]\\n\\nHOW DOES THIS HELP YOUR GROWTH\\n[Explain how knowing this deeply helps Tearra as a business owner and advisor. Does it improve her positioning, her credibility, her ability to differentiate? Does it open a new client segment or strengthen an existing one? Does it support Impactful Health or Impactful Tech or both? 3 to 5 sentences. Be honest — if it doesn't directly help growth, say so briefly.]\\n\\nREVENUE OPPORTUNITY\\n[Identify any direct or indirect path to income from this research. Could this knowledge lead to a new client conversation, a product to offer, a segment to target, an offer to build, or a referral to generate? Be specific. If there is no clear revenue angle, say: No direct revenue angle — this is foundational knowledge that supports long-term positioning. Do not force a revenue connection that isn't real.]\\n\\nCONTENT ANGLE\\n[Identify one specific piece of content this research could generate. Name the format (Instagram post, email, short video script, blog article, LinkedIn post), name the target audience, and write one sentence describing what the content would say or teach. Example: Instagram carousel for small business owners explaining what ICHRA is and why it costs less than group insurance.]\\n\\nACTION SIGNAL\\n[Name one specific, concrete next step Tearra could take based on this research. Not a vague suggestion — a real action. Could be a client conversation to start, a follow-up to make, a content piece to create, a system to update, a tool to explore, or a decision to make. One action only. Be direct.]\\n\\nAGENT BRIEFING LINE\\n[Write one sentence formatted for downstream AI agent consumption. Include: topic, key finding, business relevance, and recommended agent action. Format: TOPIC: [topic] | FINDING: [one sentence key finding] | RELEVANCE: [Impactful Health or Impactful Tech or both] | AGENT ACTION: [what the agent should do with this — reference in content, flag for sales, use in client education, etc.]]"
}

Tag rules:
- 3 to 6 tags maximum
- Each tag: lowercase, 1 to 4 words, specific and descriptive
- Tags must reflect the main topic, relevant subtopics, business relevance, and year if applicable
- Do not use generic tags like research, information, overview, or update
- Good tag examples: ichra-2026, small-employers, chattanooga, medicare-advantage, ai-automation, health-insurance-agents`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system:
      'You are a research filing assistant. Return only a valid JSON object — no markdown, no explanation, no preamble.',
    messages: [{ role: 'user', content: structuringPrompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Structuring call returned no output')
  }

  // Strip markdown fences if Claude included them despite instructions
  const jsonText = textBlock.text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const structured = JSON.parse(jsonText) as StructuredResearch

  // Validate required fields
  const required = ['task_title', 'output_title', 'summary', 'full_text', 'category_id']
  for (const field of required) {
    if (!structured[field as keyof StructuredResearch]) {
      throw new Error(`Structured output missing required field: ${field}`)
    }
  }

  // Validate category_id is a known UUID
  if (!categories.find((c) => c.id === structured.category_id)) {
    throw new Error(`category_id "${structured.category_id}" does not match any known category`)
  }

  // Log warning if breakdown missing — entry still files
  if (!structured.plain_language_breakdown) {
    console.warn('plain_language_breakdown missing from structured output — filing without it')
  }

  return structured
}

// Step 2 (people): Structure people research into a DB-ready JSON object with 8-layer breakdown
export async function structurePeopleResearch(
  personName: string,
  specificTopic: string | null,
  researchOutput: string,
  categories: CategoryRecord[],
  projects: ProjectRecord[]
): Promise<StructuredResearch> {
  const categoryList = categories.map((c) => `- ${c.name} (id: ${c.id})`).join('\n')
  const projectList = projects.map((p) => `- ${p.name} (id: ${p.id})`).join('\n')
  const truncatedOutput = researchOutput.slice(0, 40000)
  const focusLine = specificTopic ?? 'general — full body of work'

  const structuringPrompt = `You are Olivia Pope — a sharp research and intelligence advisor for Impactful Financial Solutions, owned by Tearra, a health insurance agent and AI tech builder in Chattanooga, Tennessee.

You have just completed research on a thought leader, entrepreneur, or industry figure. Your job is to extract the most strategically relevant intelligence from their body of work and structure it as a business intelligence record.

This is NOT a biography. Do not summarize their life story.
This IS an intelligence extraction. Extract what they teach, how they think, and what is directly applicable to Tearra's business.

PERSON RESEARCHED: ${personName}
SPECIFIC FOCUS (if provided): ${focusLine}

RAW RESEARCH OUTPUT:
${truncatedOutput}

Tearra's business context:
- Impactful Health: health insurance agency — individual, small group, ICHRA, Medicare
- Impactful Tech: AI systems and automation for small businesses, AI Bootcamps for agents
- Current focus: learning Medicare, growing ICHRA book, building authority, AI Bootcamps
- Revenue target: $7,000–$8,000/month
- Primary clients: individuals, small business owners, health insurance agents

AVAILABLE CATEGORIES (select exactly one — use the exact id):
${categoryList}

AVAILABLE PROJECTS (select one or null — use the exact id):
${projectList}

Return ONLY a valid JSON object. No preamble. No explanation. No markdown fences.

{
  "task_title": "Research: ${personName} — [primary topic of their work, max 60 chars]",

  "output_title": "${personName}: [what this research covers — their primary framework or focus]. Max 120 chars.",

  "summary": "2 to 5 sentences for agent retrieval. Who this person is, what they primarily teach, and the single most applicable idea for Tearra's business. Not plain language — structured for machine reading. Max 500 chars.",

  "full_text": "The complete research output fully preserved. Do not truncate.",

  "source_notes": "Their YouTube channel URL, website, book titles, or other primary sources found. Empty string if none confirmed.",

  "category_id": "exact uuid of the category that best matches the primary subject of their work",

  "project_id": "exact uuid of the most relevant current project, or null if broadly applicable",

  "tags": ["[person-name-slug]", "thought-leader", "tag3", "tag4", "tag5"],

  "plain_language_breakdown": "WHAT IS THIS\\n[Who is this person and what do they primarily teach? Explain as if Tearra has never heard of them. What is the one idea or framework they are most known for? 3 to 5 sentences. Plain language — no jargon.]\\n\\nWHY DOES THIS MATTER RIGHT NOW\\n[Why is this person's thinking relevant specifically for Tearra in 2026? What about their approach connects to where Tearra is in her business right now — building authority, growing revenue, learning Medicare, running AI Bootcamps? Be specific. 3 to 5 sentences.]\\n\\nHOW DOES THIS HELP YOUR CLIENTS\\n[How could Tearra apply this person's frameworks or ideas to serve her clients better? What would a health insurance client, small business owner, or Medicare prospect benefit from if Tearra internalized this thinking? 3 to 5 sentences.]\\n\\nHOW DOES THIS HELP YOUR GROWTH\\n[Which specific frameworks or ideas from this person apply most directly to Impactful Health or Impactful Tech growth? Name the framework. Name the application. Be specific about how Tearra would use it. 3 to 5 sentences.]\\n\\nREVENUE OPPORTUNITY\\n[Is there a direct path from this person's ideas to a revenue move for Tearra? Could their offer model, pricing philosophy, sales framework, or positioning strategy be adapted to health insurance or AI services? Name it specifically. If there is no direct revenue angle, say so honestly.]\\n\\nCONTENT ANGLE\\n[What content could Tearra create inspired by or referencing this person's frameworks? Name the format, the target audience, and what the content would say. One specific idea. Example: A LinkedIn post for health insurance agents explaining how Alex Hormozi's value equation applies to ICHRA sales conversations.]\\n\\nACTION SIGNAL\\n[One specific action Tearra could take based on this research. Could be: apply a specific framework to a current challenge, read or watch a specific resource from this person, adapt a specific idea to her offer or messaging, or reference their thinking in an upcoming piece of content. One action. Specific enough to do this week.]\\n\\nAGENT BRIEFING LINE\\n[PERSON: ${personName} | SPECIALTY: [their primary domain] | KEY FRAMEWORK: [their most cited or applicable framework in one sentence] | RELEVANCE: [Impactful Health or Impactful Tech or both] | AGENT ACTION: [what a content, sales, or CRM agent should do with this intelligence]]"
}

Tag rules for people research:
- First tag MUST be the person's name as a slug: dan-martell, myron-golden, alex-hormozi
- Second tag MUST be: thought-leader
- Remaining 3 to 4 tags: specific topics they cover — offer-design, sales-frameworks, content-strategy, medicare, ai-automation, etc.
- Total tags: 4 to 6 maximum
- Do not use generic tags like research, person, or youtube`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system:
      'You are a research filing assistant. Return only a valid JSON object — no markdown, no explanation, no preamble.',
    messages: [{ role: 'user', content: structuringPrompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('People structuring call returned no output')
  }

  const jsonText = textBlock.text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const structured = JSON.parse(jsonText) as StructuredResearch

  const required = ['task_title', 'output_title', 'summary', 'full_text', 'category_id']
  for (const field of required) {
    if (!structured[field as keyof StructuredResearch]) {
      throw new Error(`People structured output missing required field: ${field}`)
    }
  }

  if (!categories.find((c) => c.id === structured.category_id)) {
    throw new Error(`category_id "${structured.category_id}" does not match any known category`)
  }

  if (!structured.plain_language_breakdown) {
    console.warn('[person] plain_language_breakdown missing — filing without it')
  }

  return structured
}

// General conversational chat (non-research messages)
export async function chat(
  messages: Anthropic.MessageParam[],
  systemPrompt: string = OLIVIA_SYSTEM_PROMPT
): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  return textBlock?.type === 'text'
    ? textBlock.text
    : 'Tearra, I ran into an issue processing that. Try again.'
}
