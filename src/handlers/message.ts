import type { Context } from 'grammy'
import { chat } from '../services/claude.js'

export async function handleMessage(ctx: Context) {
  const text = ctx.message?.text
  if (!text || text.startsWith('/')) return

  try {
    const response = await chat([{ role: 'user', content: text }])
    await ctx.reply(response)
  } catch (err) {
    console.error('Message handler error:', err)
    await ctx.reply('Tearra, I ran into an issue. Try again.')
  }
}
