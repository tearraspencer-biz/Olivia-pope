import Anthropic from '@anthropic-ai/sdk'
import { RESEARCH_SYSTEM_PROMPT, OLIVIA_SYSTEM_PROMPT, CATEGORIES } from '../prompts/system.js'
import type { Category } from '../prompts/system.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface ResearchResult {
  title: string
  summary: string
  full_text: string
  category: Category
  tags: string[]
  source_notes?: string
  telegram_bullets: string[]
}

export async function conductResearch(topic: string): Promise<ResearchResult> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: RESEARCH_SYSTEM_PROMPT,
    tools: [
      {
        name: 'file_research',
        description: 'Structure and file research findings to the Intelligence Hub',
        input_schema: {
          type: 'object' as const,
          properties: {
            title: {
              type: 'string',
              description:
                'Concise, specific title for this research entry (e.g., "ICHRA Employer Adoption Trends Q1 2026")',
            },
            summary: {
              type: 'string',
              description: '2-3 sentence executive summary of the key findings',
            },
            full_text: {
              type: 'string',
              description:
                'Complete research findings — comprehensive, well-organized, with all relevant data, analysis, and context. Use clear sections and line breaks.',
            },
            category: {
              type: 'string',
              enum: [...CATEGORIES],
              description: 'The most relevant category for this research',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description:
                '3-6 specific lowercase tags (e.g., ["chattanooga", "aca-marketplace", "2026-enrollment"])',
            },
            source_notes: {
              type: 'string',
              description:
                'Optional: key sources, data providers, regulatory references, or methodological notes',
            },
            telegram_bullets: {
              type: 'array',
              items: { type: 'string' },
              description:
                '3-5 punchy bullet points for the Telegram summary — the most critical findings Tearra needs to act on immediately',
            },
          },
          required: ['title', 'summary', 'full_text', 'category', 'tags', 'telegram_bullets'],
        },
      },
    ],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: `Research request: ${topic}` }],
  })

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return structured research output')
  }

  return toolUse.input as ResearchResult
}

export async function chat(
  messages: Anthropic.MessageParam[],
  systemPrompt: string = OLIVIA_SYSTEM_PROMPT
): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  return textBlock?.type === 'text'
    ? textBlock.text
    : 'Tearra, I ran into an issue processing that. Try again.'
}
