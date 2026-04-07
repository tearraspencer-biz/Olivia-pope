import Anthropic from '@anthropic-ai/sdk'
import { OLIVIA_SYSTEM_PROMPT } from '../prompts/system.js'
import type { CategoryRecord, ProjectRecord } from '../cache.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-4-5'

export interface StructuredResearch {
  task_title: string
  output_title: string
  summary: string
  full_text: string
  source_notes: string
  category_id: string
  project_id: string | null
  tags: string[]
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

// Step 2: Structure the research output into a DB-ready JSON object
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

  const structuringPrompt = `You are a research filing assistant. You have just completed a research task.
Your job is to structure this research output into a clean, organized database record.

RESEARCH TOPIC (original request):
${topic}

RESEARCH OUTPUT:
${truncatedOutput}

AVAILABLE CATEGORIES (select exactly one):
${categoryList}

AVAILABLE PROJECTS (select one or leave null):
${projectList}

Return ONLY a valid JSON object. No preamble. No explanation. No markdown fences.
Use this exact structure:

{
  "task_title": "Short descriptive title for the research task (max 80 chars)",
  "output_title": "Full descriptive title for the research output (max 120 chars)",
  "summary": "2 to 5 sentences summarizing what this research covers and why it matters. Written for quick agent retrieval. Max 500 chars.",
  "full_text": "The complete research output, fully preserved, formatted cleanly.",
  "source_notes": "Any sources, links, or references mentioned. Empty string if none.",
  "category_id": "[exact uuid of the most relevant category from the list above]",
  "project_id": "[exact uuid of the most relevant project from the list above, or null if unclear]",
  "tags": ["tag1", "tag2", "tag3"]
}

Tag rules:
- 3 to 6 tags maximum
- Each tag: lowercase, 1 to 4 words, specific and descriptive
- Tags should reflect: main topic, subtopics, business relevance, year if applicable
- Do not create generic tags like "research" or "information"`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
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
