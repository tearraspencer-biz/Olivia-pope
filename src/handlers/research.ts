import type { CommandContext, Context } from 'grammy'
import { runResearch, structureResearch } from '../services/claude.js'
import { saveResearch } from '../services/supabase.js'
import { getCache } from '../cache.js'

const DASHBOARD_URL = (process.env.DASHBOARD_URL ?? '').replace(/\/$/, '')

export async function handleResearch(ctx: CommandContext<Context>) {
  const topic = ctx.match?.trim()

  if (!topic) {
    await ctx.reply(
      'What should I research? Send your topic after /research.\n\nExample: /research ICHRA employer eligibility rules 2025'
    )
    return
  }

  // Acknowledge immediately
  const ackMsg = await ctx.reply(
    `On it. Researching: ${topic}\n\nThis will take a moment.`
  )

  let researchOutput: string | null = null

  try {
    // Step 1 — Run research
    researchOutput = await runResearch(topic)
  } catch (err) {
    console.error('Research run failed:', err)
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        ackMsg.message_id,
        `⚠️ Research failed for: ${topic}\n\nSomething went wrong during the research run. Please try again.\nIf the issue continues, file the research manually in the dashboard.`
      )
    } catch { /* suppress */ }
    return
  }

  let structured
  try {
    // Step 2 — Structure via Claude
    const { categories, projects } = await getCache()
    structured = await structureResearch(topic, researchOutput, categories, projects)
  } catch (err) {
    console.error('Structuring failed:', err)
    const excerpt = researchOutput.slice(0, 3000)
    const truncated = researchOutput.length > 3000 ? `\n\n[truncated — full output in logs]` : ''
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        ackMsg.message_id,
        `⚠️ Research completed but could not be auto-structured.\n\nHere is what I found:\n\n${excerpt}${truncated}\n\nPlease file this manually in the dashboard.`
      )
    } catch { /* suppress */ }
    return
  }

  try {
    // Step 3 — Write to Supabase
    const { categories, projects } = await getCache()
    const result = await saveResearch(structured, topic, categories, projects)

    // Step 4 — Send confirmation
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
      ? `\nView in dashboard → ${DASHBOARD_URL}/research/${result.outputId}`
      : ''

    const confirmation =
      `✅ Research filed to Intelligence Hub.\n\n` +
      `📄 ${result.outputTitle}\n` +
      `📂 Category: ${result.categoryName}\n` +
      `${projectLine}` +
      `${tagLine}` +
      `\n${summaryText}` +
      dashboardLink

    await ctx.api.editMessageText(ctx.chat.id, ackMsg.message_id, confirmation)
  } catch (err) {
    console.error('Supabase write failed:', err)
    const excerpt = researchOutput.slice(0, 3000)
    const truncated = researchOutput.length > 3000 ? `\n\n[truncated — full output in logs]` : ''
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        ackMsg.message_id,
        `⚠️ Research completed but could not be filed to the database.\n\nHere is what I found:\n\n${excerpt}${truncated}\n\nPlease file this manually in the dashboard when you get a chance.`
      )
    } catch { /* suppress */ }
  }
}
