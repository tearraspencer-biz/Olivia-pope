/**
 * Run once after Railway deployment to register the webhook with Telegram.
 * This also clears any existing long-polling (OpenClaw) automatically.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=xxx WEBHOOK_URL=https://your-app.up.railway.app npm run set-webhook
 */

const token = process.env.TELEGRAM_BOT_TOKEN
const webhookUrl = process.env.WEBHOOK_URL

if (!token || !webhookUrl) {
  console.error('Error: TELEGRAM_BOT_TOKEN and WEBHOOK_URL are required.')
  process.exit(1)
}

const url = `https://api.telegram.org/bot${token}/setWebhook?url=${webhookUrl}/webhook`

const response = await fetch(url)
const data = await response.json()

if (data.ok) {
  console.log('Webhook set successfully.')
  console.log(`Telegram will now POST updates to: ${webhookUrl}/webhook`)
  console.log('OpenClaw long polling is now inactive for this token.')
} else {
  console.error('Failed to set webhook:', data)
  process.exit(1)
}
