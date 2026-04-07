import http from 'http'
import { bot } from './bot.js'

// Minimal health server so Railway's health check passes
const PORT = Number(process.env.PORT) || 3000
http
  .createServer((_req, res) => {
    res.writeHead(200)
    res.end('Olivia Pope Intelligence Agent — online.')
  })
  .listen(PORT, () => console.log(`Health server on port ${PORT}`))

// Long polling — takes over from any webhook
bot.start({
  onStart: () => console.log('Olivia Pope is online and polling.'),
})
