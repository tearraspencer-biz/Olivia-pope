import type { CommandContext, Context } from 'grammy'
import { runResearch, structurePeopleResearch } from '../services/claude.js'
import { saveResearch } from '../services/supabase.js'
import { getCache } from '../cache.js'

const DASHBOARD_URL = (process.env.DASHBOARD_URL ?? '').replace(/\/$/, '')

// Separators accepted for /person [name] — [topic]
const TOPIC_SEPARATORS = [' — ', ' -- ', ' - ']

function generatePersonSlug(personName: string): string {
  return personName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
}

function enforcePersonTags(tags: string[], personName: string): string[] {
  const personSlug = generatePersonSlug(personName)
  const requiredTags = [personSlug, 'thought-leader']
  const existingTags = tags ?? []
  const missingTags = requiredTags.filter((tag) => !existingTags.includes(tag))
  return [...missingTags, ...existingTags].slice(0, 6)
}

function parsePersonCommand(raw: string): { personName: string; specificTopic: string | null } {
  let personName = raw.trim()
  let specificTopic: string | null = null

  for (const sep of TOPIC_SEPARATORS) {
    const idx = raw.indexOf(sep)
    if (idx !== -1) {
      personName = raw.slice(0, idx).trim()
      specificTopic = raw.slice(idx + sep.length).trim() || null
      break
    }
  }

  return { personName, specificTopic }
}

function buildResearchTopic(personName: string, specificTopic: string | null): string {
  if (specificTopic) {
    return (
      `Research what ${personName} specifically teaches about "${specificTopic}". ` +
      `Pull from their YouTube content, website, books, courses, and interviews. ` +
      `Extract their specific frameworks, methodologies, and actionable approaches. ` +
      `Focus on what is directly applicable to a health insurance agent and AI tech builder ` +
      `in Chattanooga, Tennessee. This is intelligence extraction — not a biography.`
    )
  }
  return (
    `Research ${personName} comprehensively — who they are, their primary frameworks and ` +
    `methodologies, their offer model, content strategy, and most applicable ideas for a ` +
    `health insurance and AI tech business. Cover their YouTube content, website, published ` +
    `books, podcast appearances, and social media presence. ` +
    `Extract what they teach, not their life story. ` +
    `Focus on what is directly applicable to a health insurance agent and AI tech builder ` +
    `in Chattanooga, Tennessee.`
  )
}

export async function handlePerson(ctx: CommandContext<Context>) {
  const raw = ctx.match?.trim()

  if (!raw) {
    await ctx.reply(
      'Who should I research? Send a name after /person.\n\n' +
        'Examples:\n' +
        '• /person Dan Martell\n' +
        '• /person Myron Golden — sales frameworks\n' +
        '• /person Alex Hormozi — offer pricing'
    )
    return
  }

  const { personName, specificTopic } = parsePersonCommand(raw)

  if (!personName) {
    await ctx.reply(
      'Who should I research? Send a name after /person.\n\n' +
        'Examples:\n' +
        '• /person Dan Martell\n' +
        '• /person Alex Hormozi — offer pricing'
    )
    return
  }

  // Acknowledge immediately
  const ackMsg = await ctx.reply(
    specificTopic
      ? `On it. Researching what ${personName} teaches about "${specificTopic}".\n\nThis will take a moment.`
      : `On it. Researching ${personName} — pulling from their YouTube, website, interviews, and published frameworks.\n\nThis will take a moment.`
  )

  let researchOutput: string | null = null

  try {
    const topic = buildResearchTopic(personName, specificTopic)
    researchOutput = await runResearch(topic)
  } catch (err) {
    console.error('[/person] Research failed:', err)
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        ackMsg.message_id,
        `⚠️ Research failed for: ${personName}\n\nSomething went wrong during the research run. Please try again.\n/person ${raw}`
      )
    } catch { /* suppress */ }
    return
  }

  let structured
  try {
    const { categories, projects } = await getCache()
    structured = await structurePeopleResearch(
      personName,
      specificTopic,
      researchOutput,
      categories,
      projects
    )

    // Enforce person slug + thought-leader tags regardless of what Claude returned
    structured.tags = enforcePersonTags(structured.tags ?? [], personName)
  } catch (err) {
    console.error('[/person] Structuring failed:', err)
    const excerpt = researchOutput.slice(0, 3000)
    const truncated = researchOutput.length > 3000 ? '\n\n[truncated — full output in logs]' : ''
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        ackMsg.message_id,
        `⚠️ Research completed but could not be structured for filing.\n\nHere is what I found on ${personName}:\n\n${excerpt}${truncated}\n\nPlease file this manually in the dashboard.`
      )
    } catch { /* suppress */ }
    return
  }

  try {
    const { categories, projects } = await getCache()
    const result = await saveResearch(structured, raw, categories, projects)

    const tagLine = result.tags.length > 0
      ? `🏷️ Tags: ${result.tags.join(', ')}\n`
      : ''
    const projectLine = result.projectName
      ? `📁 Project: ${result.projectName}\n`
      : ''
    const summaryText = result.summary.length > 400
      ? result.summary.slice(0, 400) + '...'
      : result.summary
    const dashboardLink = DASHBOARD_URL
      ? `\nView → ${DASHBOARD_URL}/research/${result.outputId}`
      : ''
    const breakdownLine = structured.plain_language_breakdown
      ? `\n📊 Full breakdown with frameworks, revenue opportunity, content angle, and action signal in the dashboard.`
      : `\n⚠️ Note: Breakdown was not generated for this entry — file manually if needed.`

    const confirmation =
      `👤 People Intelligence filed to Intelligence Hub.\n\n` +
      `📄 ${result.outputTitle}\n` +
      `📂 Category: ${result.categoryName}\n` +
      `${projectLine}` +
      `${tagLine}` +
      `\n${summaryText}` +
      breakdownLine +
      dashboardLink

    await ctx.api.editMessageText(ctx.chat.id, ackMsg.message_id, confirmation)
  } catch (err) {
    console.error('[/person] Supabase write failed:', err)
    const excerpt = researchOutput.slice(0, 3000)
    const truncated = researchOutput.length > 3000 ? '\n\n[truncated — full output in logs]' : ''
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        ackMsg.message_id,
        `⚠️ Research completed but could not be filed to the database.\n\nHere is what I found on ${personName}:\n\n${excerpt}${truncated}\n\nPlease file this manually when you get a chance.`
      )
    } catch { /* suppress */ }
  }
}
