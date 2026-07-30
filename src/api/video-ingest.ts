import type { Router, Request, Response } from 'express'
import { Router as createRouter } from 'express'
import { createClient } from '@supabase/supabase-js'
import { extractVideoKnowledge, saveVideoKnowledge } from '../services/video-knowledge.js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const OLIVIA_API_KEY = process.env.OLIVIA_API_KEY

/**
 * Pull the 11-character video ID out of any YouTube URL shape.
 *
 * Stored separately from the URL and uniquely indexed, so the same video
 * submitted as a youtu.be short link, with a playlist attached, or with tracking
 * parameters is recognised as already present rather than extracted twice.
 */
export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim()

  // Already a bare ID.
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed

  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,        // watch?v=
    /youtu\.be\/([A-Za-z0-9_-]{11})/,   // youtu.be/
    /\/embed\/([A-Za-z0-9_-]{11})/,     // /embed/
    /\/shorts\/([A-Za-z0-9_-]{11})/,    // /shorts/
    /\/live\/([A-Za-z0-9_-]{11})/,      // /live/
  ]
  for (const p of patterns) {
    const m = trimmed.match(p)
    if (m) return m[1]
  }
  return null
}

async function updateStatus(
  id: string,
  status: 'processing' | 'complete' | 'failed',
  errorMessage?: string | null
): Promise<void> {
  const { error } = await supabase
    .from('videos')
    .update({
      processing_status: status,
      error_message: errorMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) console.error(`[Video Ingest] status update failed for ${id}:`, error.message)
}

async function processVideo(
  videoId: string,
  data: { title: string; channel?: string | null; url: string; transcript: string }
): Promise<void> {
  console.log(`[Video Ingest] Processing ${videoId}: "${data.title}"`)
  try {
    await updateStatus(videoId, 'processing')

    const { overview, items } = await extractVideoKnowledge(data)
    const saved = await saveVideoKnowledge(videoId, items)

    await supabase
      .from('videos')
      .update({
        overview: overview || null,
        processing_status: 'complete',
        // A video with no transferable lessons is a valid outcome, not a
        // failure — say so rather than leaving the page blank and unexplained.
        error_message: saved === 0 ? 'No transferable lessons found in this video.' : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', videoId)

    console.log(`[Video Ingest] Complete — ${videoId}: ${saved} lesson(s)`)
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown error'
    console.error(`[Video Ingest] Failed — ${videoId}:`, msg)
    // The transcript is already stored, so a failure here is retryable without
    // asking for it again.
    await updateStatus(videoId, 'failed', msg)
  }
}

export function createVideoIngestRouter(): Router {
  const router = createRouter()

  router.post('/api/video-ingest', async (req: Request, res: Response) => {
    if (!OLIVIA_API_KEY || req.headers['x-api-key'] !== OLIVIA_API_KEY) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const body = req.body ?? {}
    const url: string = (body.url ?? '').trim()
    const transcript: string = (body.transcript ?? '').trim()
    const title: string = (body.title ?? '').trim()
    const channel: string | null = (body.channel ?? '').trim() || null

    if (!url) {
      res.status(400).json({ error: 'Missing url' })
      return
    }
    const youtubeId = parseYouTubeId(url)
    if (!youtubeId) {
      res.status(400).json({ error: 'Could not find a YouTube video ID in that URL' })
      return
    }
    // A transcript short enough to be an accident produces invented lessons
    // rather than an honest empty result.
    if (transcript.length < 200) {
      res.status(400).json({ error: 'Transcript is too short to extract anything from' })
      return
    }

    const { data: video, error: insertError } = await supabase
      .from('videos')
      .insert({
        youtube_id: youtubeId,
        url: `https://www.youtube.com/watch?v=${youtubeId}`,
        title: title || `YouTube video ${youtubeId}`,
        channel,
        transcript,
        processing_status: 'pending',
      })
      .select('id')
      .single()

    // 23505 = unique_violation on youtube_id. Already submitted; the unique
    // index doing its job, not an error worth retrying.
    if (insertError?.code === '23505') {
      res.status(200).json({ message: 'Already added', duplicate: true, youtubeId })
      return
    }
    if (insertError || !video) {
      console.error('[Video Ingest] Insert failed:', insertError?.message)
      res.status(500).json({ error: 'Database insert failed', detail: insertError?.message })
      return
    }

    res.status(202).json({ message: 'Video received — extracting lessons', videoId: video.id })

    processVideo(video.id as string, { title: title || `YouTube video ${youtubeId}`, channel, url, transcript })
  })

  return router
}
