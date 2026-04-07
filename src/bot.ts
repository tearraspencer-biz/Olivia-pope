import { Bot } from 'grammy'
import { handleResearch } from './handlers/research.js'
import { handleMessage } from './handlers/message.js'

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
      '• /research [topic] — Research any topic, structure the findings, and file to the Intelligence Hub\n' +
      '• Any message — Ask me anything; I research and respond\n\n' +
      'Everything substantive gets filed to Supabase for ecosystem use.'
  )
})

bot.command('research', handleResearch)

// Returns the chat ID so TELEGRAM_CHAT_ID env var can be set for daily briefs
bot.command('chatid', async (ctx) => {
  await ctx.reply(`Your chat ID is: ${ctx.chat.id}`)
})

bot.on('message:text', handleMessage)

bot.catch((err) => {
  console.error('Unhandled bot error:', err)
})
