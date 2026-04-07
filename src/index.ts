import http from 'http'
import cron from 'node-cron'
import { bot } from './bot.js'
import { refreshCache } from './cache.js'
import { runDailyBrief } from './daily-brief.js'

// Minimal health server so Railway's health check passes
const PORT = Number(process.env.PORT) || 3000
http
  .createServer((_req, res) => {
    res.writeHead(200)
    res.end('Olivia Pope Intelligence Agent — online.')
  })
  .listen(PORT, () => console.log(`Health server on port ${PORT}`))

// Pre-load categories and projects cache before bot starts
refreshCache()
  .then(() => console.log('Startup cache loaded.'))
  .catch((err) => console.error('Cache load failed (will retry on first request):', err))

// Daily brief — 7:00am ET every day (handles EST/EDT automatically)
cron.schedule(
  '0 7 * * *',
  async () => {
    console.log('[Cron] Daily brief triggered')
    await runDailyBrief()
  },
  { timezone: 'America/New_York' }
)
console.log('Daily brief scheduled: 7:00am ET every day.')

// Start polling with retry on 409 conflict (Railway deployment rollover)
async function startPolling(attempt = 1): Promise<void> {
  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: () => console.log('Olivia Pope is online and polling.'),
    })
  } catch (err: any) {
    if (err?.error_code === 409) {
      const delay = attempt * 10000
      console.log(`409 Conflict — another instance is still running. Retrying in ${delay / 1000}s...`)
      await new Promise((r) => setTimeout(r, delay))
      await startPolling(attempt + 1)
    } else {
      console.error('Fatal bot error:', err)
      process.exit(1)
    }
  }
}

startPolling()
