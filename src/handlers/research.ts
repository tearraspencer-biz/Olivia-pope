import type { CommandContext, Context } from 'grammy'
import { conductResearch } from '../services/claude.js'
import { saveResearch } from '../services/supabase.js'

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? ''

export async function handleResearch(ctx: CommandContext<Context>) {
  const topic = ctx.match?.trim()

  if (!topic) {
    await ctx.reply(
      'Tearra, I need a topic.\n\nUsage: /research [topic]\n\nExample:\n/research ICHRA adoption trends for small employers in 2026'
    )
    return
  }

  const ackMsg = await ctx.reply('Tearra, on it. Pulling intelligence now...')

  try {
    const result = await conductResearch(topic)
    const outputId = await saveResearch(result, topic)

    const bullets = result.telegram_bullets.map((b) => `• ${b}`).join('\n')

    const dashboardLink =
      outputId && DASHBOARD_URL
        ? `\n\n[View full report →](${DASHBOARD_URL}/research/${outputId})`
        : ''

    const filedStatus = outputId
      ? '\n\n_Filed to Intelligence Hub._'
      : '\n\n_(Filing to Hub failed — check Supabase connection)_'

    const reply =
      `Tearra, here's the intelligence brief:\n\n` +
      `*${escapeMarkdown(result.title)}*\n\n` +
      `${bullets}` +
      dashboardLink +
      filedStatus

    await ctx.api.editMessageText(ctx.chat.id, ackMsg.message_id, reply, {
      parse_mode: 'Markdown',
    })
  } catch (err) {
    console.error('Research handler error:', err)
    await ctx.api.editMessageText(
      ctx.chat.id,
      ackMsg.message_id,
      'Tearra, I hit a snag pulling that intelligence. Check the logs and try again.'
    )
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')
}
