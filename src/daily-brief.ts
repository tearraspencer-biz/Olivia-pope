import { createClient } from '@supabase/supabase-js'
import { runResearch, structureResearch } from './services/claude.js'
import { saveResearch } from './services/supabase.js'
import { getCache } from './cache.js'
import { medicareTopics, rotatingTopics, dayFocusLabels } from './topics.js'
import type { DayOfWeek } from './topics.js'
import type { SaveResult } from './services/supabase.js'
import type { StructuredResearch } from './services/claude.js'

const stateClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DASHBOARD_URL = (process.env.DASHBOARD_URL ?? '').replace(/\/$/, '')
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? ''

// ── Telegram delivery ───────────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<void> {
  if (!CHAT_ID) {
    console.warn('[Daily Brief] TELEGRAM_CHAT_ID not set — skipping Telegram delivery')
    return
  }
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text }),
    }
  )
  if (!res.ok) {
    const body = await res.text()
    console.error('[Daily Brief] Telegram send failed:', body)
  }
}

// ── State management ────────────────────────────────────────────────────────

async function getIndex(key: string): Promise<number> {
  const { data, error } = await stateClient
    .from('daily_brief_state')
    .select('value')
    .eq('key', key)
    .single()
  if (error) console.error(`[Daily Brief] getIndex(${key}) error:`, error.message)
  return data?.value ?? 0
}

async function setIndex(key: string, value: number): Promise<void> {
  const { error } = await stateClient
    .from('daily_brief_state')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key)
  if (error) console.error(`[Daily Brief] setIndex(${key}) error:`, error.message)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getDayOfWeek(): DayOfWeek {
  const days: DayOfWeek[] = [
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  ]
  return days[new Date().getDay()]
}

function extractActionSignal(breakdown: string | undefined | null): string {
  if (!breakdown) return ''
  const startIdx = breakdown.indexOf('ACTION SIGNAL')
  if (startIdx === -1) return ''
  const endIdx = breakdown.indexOf('AGENT BRIEFING LINE')
  const start = startIdx + 'ACTION SIGNAL'.length
  const end = endIdx !== -1 ? endIdx : breakdown.length
  return breakdown.slice(start, end).trim()
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text
}

// ── Research + file one topic ────────────────────────────────────────────────

interface BriefEntry {
  result: SaveResult
  structured: StructuredResearch
}

async function researchAndFile(topic: string): Promise<BriefEntry> {
  const researchOutput = await runResearch(topic)
  const { categories, projects } = await getCache()
  const structured = await structureResearch(topic, researchOutput, categories, projects)

  // Tag as daily-brief so the Daily Briefings dashboard page can identify it
  if (!structured.tags) structured.tags = []
  if (!structured.tags.includes('daily-brief')) {
    structured.tags = ['daily-brief', ...structured.tags]
  }

  const result = await saveResearch(structured, topic, categories, projects)
  return { result, structured }
}

// ── Confirmation message builder ────────────────────────────────────────────

function buildConfirmation(
  day: DayOfWeek,
  dateStr: string,
  medicareEntry: BriefEntry,
  rotatingEntry: BriefEntry
): string {
  const medicareAction = extractActionSignal(medicareEntry.structured.plain_language_breakdown)
  const rotatingAction = extractActionSignal(rotatingEntry.structured.plain_language_breakdown)
  const dayLabel = dayFocusLabels[day]

  const medicareTags = (medicareEntry.result.tags ?? []).slice(0, 3).join(', ')
  const rotatingTags = (rotatingEntry.result.tags ?? []).slice(0, 3).join(', ')

  const medicareLink = DASHBOARD_URL
    ? `${DASHBOARD_URL}/research/${medicareEntry.result.outputId}`
    : ''
  const rotatingLink = DASHBOARD_URL
    ? `${DASHBOARD_URL}/research/${rotatingEntry.result.outputId}`
    : ''

  const day_cap = day.charAt(0).toUpperCase() + day.slice(1)

  return (
    `📋 Daily Intelligence Brief — ${day_cap}, ${dateStr}\n\n` +
    `——————————————————\n` +
    `🏥 MEDICARE INTELLIGENCE\n` +
    `${medicareEntry.result.outputTitle}\n` +
    `📂 ${medicareEntry.result.categoryName}  🏷️ ${medicareTags}\n\n` +
    `${truncate(medicareEntry.result.summary, 300)}\n\n` +
    (medicareAction ? `Action Signal: ${truncate(medicareAction, 200)}\n\n` : '') +
    (medicareLink ? `View → ${medicareLink}\n` : '') +
    `\n——————————————————\n` +
    `📊 ${dayLabel}\n` +
    `${rotatingEntry.result.outputTitle}\n` +
    `📂 ${rotatingEntry.result.categoryName}  🏷️ ${rotatingTags}\n\n` +
    `${truncate(rotatingEntry.result.summary, 300)}\n\n` +
    (rotatingAction ? `Action Signal: ${truncate(rotatingAction, 200)}\n\n` : '') +
    (rotatingLink ? `View → ${rotatingLink}\n` : '') +
    `\n——————————————————\n` +
    `Both entries filed to Intelligence Hub.`
  )
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function runDailyBrief(): Promise<void> {
  const startTime = new Date()
  console.log(`[Daily Brief] Starting — ${startTime.toISOString()}`)

  const day = getDayOfWeek()
  const dateStr = startTime.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  // Determine today's topics
  const medicareIdx = await getIndex('medicare_index')
  const rotatingIdx = await getIndex(`${day}_index`)

  const medicareTopic = medicareTopics[medicareIdx % medicareTopics.length]
  const dayConfig = rotatingTopics[day]
  const rotatingTopic = dayConfig.prompts[rotatingIdx % dayConfig.prompts.length]

  console.log(`[Daily Brief] Medicare topic [${medicareIdx}]: ${medicareTopic}`)
  console.log(`[Daily Brief] ${day} topic [${rotatingIdx}]: ${rotatingTopic}`)

  let medicareEntry: BriefEntry | null = null
  let rotatingEntry: BriefEntry | null = null
  let medicareError: string | null = null
  let rotatingError: string | null = null

  // Research sequentially — no parallel to avoid resource issues
  try {
    medicareEntry = await researchAndFile(medicareTopic)
    console.log('[Daily Brief] Medicare entry filed:', medicareEntry.result.outputId)
  } catch (err: any) {
    medicareError = err?.message ?? 'Unknown error'
    console.error('[Daily Brief] Medicare research failed:', medicareError)
  }

  try {
    rotatingEntry = await researchAndFile(rotatingTopic)
    console.log('[Daily Brief] Rotating entry filed:', rotatingEntry.result.outputId)
  } catch (err: any) {
    rotatingError = err?.message ?? 'Unknown error'
    console.error('[Daily Brief] Rotating research failed:', rotatingError)
  }

  // Increment indexes only on success
  if (!medicareError) {
    await setIndex('medicare_index', (medicareIdx + 1) % medicareTopics.length)
  }
  if (!rotatingError) {
    await setIndex(`${day}_index`, (rotatingIdx + 1) % dayConfig.prompts.length)
  }

  const day_cap = day.charAt(0).toUpperCase() + day.slice(1)

  // Send consolidated Telegram message
  if (medicareEntry && rotatingEntry) {
    await sendTelegram(buildConfirmation(day, dateStr, medicareEntry, rotatingEntry))
  } else if (medicareEntry || rotatingEntry) {
    const success = (medicareEntry ?? rotatingEntry)!
    const failedTopic = medicareError ? medicareTopic : rotatingTopic
    const failedLabel = medicareError ? 'Medicare' : day_cap
    const link = DASHBOARD_URL
      ? `${DASHBOARD_URL}/research/${success.result.outputId}`
      : ''

    await sendTelegram(
      `📋 Daily Intelligence Brief — ${day_cap}, ${dateStr}\n\n` +
      `✅ ${success.result.outputTitle} — filed successfully\n` +
      (link ? `View → ${link}\n\n` : '\n') +
      `⚠️ ${failedLabel} topic — research failed\n` +
      `Topic: ${truncate(failedTopic, 100)}\n\n` +
      `You can research this manually:\n/research ${truncate(failedTopic, 100)}`
    )
  } else {
    await sendTelegram(
      `⚠️ Daily Brief Failed — ${day_cap}, ${dateStr}\n\n` +
      `Both research topics encountered errors. No entries filed today.\n\n` +
      `You can run these manually:\n` +
      `• /research ${truncate(medicareTopic, 100)}\n` +
      `• /research ${truncate(rotatingTopic, 100)}\n\n` +
      `Check Railway logs for details.`
    )
  }

  console.log(`[Daily Brief] Complete — ${new Date().toISOString()}`)
}
