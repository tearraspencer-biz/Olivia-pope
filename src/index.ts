import express from 'express'
import cron from 'node-cron'
import { bot } from './bot.js'
import { refreshCache } from './cache.js'
import { runDailyBrief } from './daily-brief.js'
import { createResearchRequestRouter } from './api/research-request.js'
import { createMeetingIngestRouter } from './api/meeting-ingest.js'

const app = express()
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Health check
app.get('/', (_req, res) => {
  res.status(200).send('Olivia Pope Intelligence Agent — online.')
})

// Debug echo — POST anything here to see exactly what the server receives
app.post('/api/echo', (req, res) => {
  res.json({
    body: req.body,
    body_keys: Object.keys(req.body ?? {}),
    content_type: req.headers['content-type'],
    has_auth: !!req.headers['x-api-key'],
  })
})

// Dashboard research request endpoint
app.use(createResearchRequestRouter())

// Fathom meeting ingest endpoint (via Zapier)
app.use(createMeetingIngestRouter())

const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, () => console.log(`Server on port ${PORT}`))

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
