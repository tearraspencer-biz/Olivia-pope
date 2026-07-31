import type { Router, Request, Response } from 'express'
import { Router as createRouter } from 'express'
import { createClient } from '@supabase/supabase-js'
import { extractKnowledge, saveKnowledge } from '../services/knowledge.js'
import { extractVideoKnowledge, saveVideoKnowledge } from '../services/video-knowledge.js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const OLIVIA_API_KEY = process.env.OLIVIA_API_KEY

/**
 * Run lesson extraction on its own, against a transcript already stored.
 *
 * Two jobs, one path:
 *   - meetings ingested before extraction existed (135 of them) can be mined
 *     without redoing the Claude analysis, business lens, and four exports that
 *     re-running the whole ingest would repeat
 *   - a video whose extraction failed can be retried without deleting it, which
 *     would discard the pasted transcript — the one part the system cannot
 *     regenerate, since YouTube blocks automated caption access
 */
async function runMeeting(meetingId: string, replace: boolean): Promise<void> {
  try {
    await supabase
      .from('meetings')
      .update({ knowledge_status: 'processing', knowledge_error: null })
      .eq('id', meetingId)

    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('title, meeting_date, duration_minutes, attendees, fathom_summary, fathom_action_items, full_transcript')
      .eq('id', meetingId)
      .single()

    if (error || !meeting) throw new Error(error?.message ?? 'Meeting not found')
    if (!meeting.full_transcript || meeting.full_transcript.length < 200) {
      throw new Error('No transcript stored for this meeting')
    }

    // Replacing is explicit. Without it a second run would append a duplicate
    // set of lessons rather than refreshing them.
    if (replace) {
      await supabase.from('knowledge').delete().eq('meeting_id', meetingId)
    }

    const items = await extractKnowledge({
      title: meeting.title,
      date: meeting.meeting_date,
      duration: meeting.duration_minutes,
      attendees: meeting.attendees,
      summary: meeting.fathom_summary,
      action_items: meeting.fathom_action_items,
      transcript: meeting.full_transcript,
    })
    const saved = await saveKnowledge(meetingId, items)

    await supabase
      .from('meetings')
      .update({
        knowledge_status: 'complete',
        // A meeting with no teachable content is a valid outcome, not a failure.
        knowledge_error: saved === 0 ? 'No teachable material found in this meeting.' : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', meetingId)

    console.log(`[Extract] Meeting ${meetingId}: ${saved} lesson(s)`)
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown error'
    console.error(`[Extract] Meeting ${meetingId} failed:`, msg)
    await supabase
      .from('meetings')
      .update({ knowledge_status: 'failed', knowledge_error: msg })
      .eq('id', meetingId)
  }
}

async function runVideo(videoId: string, replace: boolean): Promise<void> {
  try {
    await supabase
      .from('videos')
      .update({ processing_status: 'processing', error_message: null })
      .eq('id', videoId)

    const { data: video, error } = await supabase
      .from('videos')
      .select('title, channel, url, transcript')
      .eq('id', videoId)
      .single()

    if (error || !video) throw new Error(error?.message ?? 'Video not found')

    if (replace) {
      await supabase.from('knowledge').delete().eq('video_id', videoId)
    }

    const { overview, items } = await extractVideoKnowledge(video)
    const saved = await saveVideoKnowledge(videoId, items)

    await supabase
      .from('videos')
      .update({
        overview: overview || null,
        processing_status: 'complete',
        error_message: saved === 0 ? 'No transferable lessons found in this video.' : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', videoId)

    console.log(`[Extract] Video ${videoId}: ${saved} lesson(s)`)
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown error'
    console.error(`[Extract] Video ${videoId} failed:`, msg)
    await supabase
      .from('videos')
      .update({ processing_status: 'failed', error_message: msg })
      .eq('id', videoId)
  }
}

export function createExtractRouter(): Router {
  const router = createRouter()

  router.post('/api/extract', async (req: Request, res: Response) => {
    if (!OLIVIA_API_KEY || req.headers['x-api-key'] !== OLIVIA_API_KEY) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const { sourceType, id, replace } = req.body ?? {}

    if (sourceType !== 'meeting' && sourceType !== 'video') {
      res.status(400).json({ error: "sourceType must be 'meeting' or 'video'" })
      return
    }
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(400).json({ error: 'Missing or malformed id' })
      return
    }

    // Acknowledge before extracting: a long transcript takes minutes and the
    // caller should not hold a connection open for it.
    res.status(202).json({ message: 'Extracting lessons', sourceType, id })

    if (sourceType === 'meeting') runMeeting(id, Boolean(replace))
    else runVideo(id, Boolean(replace))
  })

  return router
}
