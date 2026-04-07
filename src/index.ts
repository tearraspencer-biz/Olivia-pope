import { bot } from './bot.js'

console.log('Olivia Pope Intelligence Agent — starting...')

bot.start({
  onStart: () => console.log('Olivia Pope is online and polling.'),
})
