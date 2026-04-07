import express from 'express'
import { webhookCallback } from 'grammy'
import { bot } from './bot.js'

const app = express()
app.use(express.json())

app.get('/', (_req, res) => {
  res.send('Olivia Pope Intelligence Agent — online.')
})

app.post('/webhook', webhookCallback(bot, 'express'))

const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, () => {
  console.log(`Olivia Pope bot listening on port ${PORT}`)
})
