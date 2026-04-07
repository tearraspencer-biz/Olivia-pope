import { Bot } from 'grammy'
import { handleResearch } from './handlers/research.js'
import { handlePerson } from './handlers/person.js'
import { handleMessage } from './handlers/message.js'
import { runDailyBrief } from './daily-brief.js'

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required')
}

export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN)

bot.command('start', async (ctx) => {
  await ctx.reply(
    "Tearra, I'm online and ready.\n\n" +
      'Use /research [topic] to pull intelligence and file it directly to the Hub.\n\n' +
      'Or send any message — I handle it.'
  )
})

bot.command('help', async (ctx) => {
  await ctx.reply(
    'Tearra, here is what I handle:\n\n' +
      '• /research [topic] — Research any topic and file to the Intelligence Hub\n' +
      '• /person [name] — Research a thought leader and file their frameworks\n' +
      '• /person [name] — [topic] — Targeted research on what someone teaches about a specific subject\n' +
      '• /brief — Run today\'s daily brief now (auto-runs at 7am ET)\n' +
      '• Any message — Ask me anything; I research and respond\n\n' +
      'Everything substantive gets filed to Supabase for ecosystem use.'
  )
})

bot.command('research', handleResearch)
bot.command('person', handlePerson)

// Returns the chat ID so TELEGRAM_CHAT_ID env var can be set for daily briefs
bot.command('chatid', async (ctx) => {
  await ctx.reply(`Your chat ID is: ${ctx.chat.id}`)
})

// Manual trigger for the daily brief — runs immediately on demand
bot.command('brief', async (ctx) => {
  await ctx.reply('Running daily brief now — this will take 2–3 minutes. Stand by.')
  try {
    await runDailyBrief()
  } catch (err: any) {
    console.error('[/brief] Error:', err)
    try {
      await ctx.reply(`⚠️ Daily brief encountered an error: ${err?.message ?? 'Unknown error'}`)
    } catch { /* suppress */ }
  }
})

bot.on('message:text', handleMessage)

bot.catch((err) => {
  console.error('Unhandled bot error:', err)
})
