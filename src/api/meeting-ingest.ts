import type { Router, Request, Response } from 'express'
import { Router as createRouter } from 'express'
import { createClient } from '@supabase/supabase-js'
import {
  classifyAndStructureMeeting,
  generateBusinessLens,
  type MeetingData,
  type MeetingIntelligence,
} from '../services/meeting-intel.js'
import {
  generateInternalPdf,
  generateClientPdf,
  generateInternalDocx,
  generateClientDocx,
} from '../services/exports.js'
import { extractKnowledge, saveKnowledge } from '../services/knowledge.js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const OLIVIA_API_KEY = process.env.OLIVIA_API_KEY

// ── Status helper ─────────────────────────────────────────────────────────────

async function updateMeetingStatus(
  meetingId: string,
  status: 'pending' | 'processing' | 'complete' | 'failed',
  errorMessage?: string | null
): Promise<void> {
  const { error } = await supabase
    .from('meetings')
    .update({
      processing_status: status,
      error_message: errorMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', meetingId)

  if (error) {
    console.error(`[Meeting Ingest] updateMeetingStatus(${meetingId}, ${status}) error:`, error.message)
  }
}

// ── Async processing pipeline ─────────────────────────────────────────────────

async function processMeeting(meetingId: string, data: MeetingData): Promise<void> {
  console.log(`[Meeting Ingest] Processing ${meetingId}: "${data.title}"`)

  if (!data.transcript || data.transcript.length < 50) {
    const msg = 'Meeting content too short to process. Summary or transcript may be missing.'
    console.warn(`[Meeting Ingest] ${meetingId}: ${msg}`)
    await updateMeetingStatus(meetingId, 'failed', msg)
    return
  }

  try {
    await updateMeetingStatus(meetingId, 'processing')

    // Step 1: Classify and structure meeting intelligence
    console.log(`[Meeting Ingest] Structuring intelligence for ${meetingId}`)
    const intel: MeetingIntelligence = await classifyAndStructureMeeting(data)

    // Step 2: Generate 8-layer business lens
    console.log(`[Meeting Ingest] Generating business lens for ${meetingId}`)
    const businessLens = await generateBusinessLens(data, intel)

    // Step 3: Update meeting type and intelligence (partial update — exports next)
    await supabase
      .from('meetings')
      .update({
        meeting_type: intel.overview.meeting_type,
        meeting_intelligence: intel,
        tearra_commitments: intel.tearra_commitments ?? [],
        business_lens: businessLens,
        updated_at: new Date().toISOString(),
      })
      .eq('id', meetingId)

    // Step 4: Extract reusable teaching material into the knowledge library.
    // Deliberately non-fatal, like exports below: most meetings contain no
    // teaching, and a failure here must not discard the intelligence and
    // business lens already written above.
    let knowledgeError: string | null = null
    try {
      const items = await extractKnowledge(data)
      const saved = await saveKnowledge(meetingId, items)
      console.log(`[Meeting Ingest] Extracted ${saved} knowledge item(s) for ${meetingId}`)
    } catch (err: any) {
      knowledgeError = err?.message ?? 'Knowledge extraction failed'
      console.error(`[Meeting Ingest] Knowledge extraction failed for ${meetingId}:`, knowledgeError)
    }

    // Step 5: Generate export documents
    const dateStr = data.date ?? new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const attendeesStr = data.attendees ?? 'Not recorded'

    console.log(`[Meeting Ingest] Generating exports for ${meetingId}`)
    let internalPdf: string | null = null
    let internalDocx: string | null = null
    let clientPdf: string | null = null
    let clientDocx: string | null = null
    let exportError: string | null = null

    try {
      ;[internalPdf, internalDocx, clientPdf, clientDocx] = await Promise.all([
        generateInternalPdf(meetingId, data.title, dateStr, attendeesStr, intel, businessLens, data.summary ?? null, data.action_items ?? null, intel.tearra_commitments),
        generateInternalDocx(meetingId, data.title, dateStr, attendeesStr, intel, businessLens, data.summary ?? null, data.action_items ?? null, intel.tearra_commitments),
        generateClientPdf(meetingId, data.title, dateStr, attendeesStr, intel),
        generateClientDocx(meetingId, data.title, dateStr, attendeesStr, intel),
      ])
    } catch (err: any) {
      exportError = err?.message ?? 'Export generation failed'
      console.error(`[Meeting Ingest] Export failed for ${meetingId}:`, exportError)
      // Continue — intelligence is preserved, exports are bonus
    }

    // Step 6: Final update — complete with all data
    await supabase
      .from('meetings')
      .update({
        export_internal_pdf: internalPdf,
        export_internal_docx: internalDocx,
        export_client_pdf: clientPdf,
        export_client_docx: clientDocx,
        processing_status: 'complete',
        // Both are non-fatal, so surface either without failing the meeting.
        error_message:
          [
            exportError ? `Export error: ${exportError}` : null,
            knowledgeError ? `Knowledge error: ${knowledgeError}` : null,
          ]
            .filter(Boolean)
            .join(' | ') || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', meetingId)

    console.log(`[Meeting Ingest] Complete — ${meetingId}: "${data.title}"`)
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown error'
    console.error(`[Meeting Ingest] Failed — ${meetingId}:`, msg)
    await updateMeetingStatus(
      meetingId,
      'failed',
      'Meeting could not be processed. Raw Fathom data is preserved.'
    )
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createMeetingIngestRouter(): Router {
  const router = createRouter()

  router.post('/api/meeting-ingest', async (req: Request, res: Response) => {
    // Validate API key
    const apiKey = req.headers['x-api-key']
    if (!OLIVIA_API_KEY || apiKey !== OLIVIA_API_KEY) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    // express.json() (app-level) already parsed the body
    const raw = req.body ?? {}
    // Handle both flat { title, summary } and nested { data: { title, summary } }
    const payload: Record<string, any> =
      raw?.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
        ? raw.data
        : raw

    console.log('[Meeting Ingest] Content-Type:', req.headers['content-type'], '| payload keys:', Object.keys(payload))

    const title: string | undefined = payload.title
    const date: string | undefined = payload.date
    const duration: string | number | undefined = payload.duration
    const attendees: string | undefined = payload.attendees
    const summary: string | undefined = payload.summary
    const action_items: string | undefined = payload.action_items
    const transcript: string | undefined = payload.transcript
    // Fathom's immutable recording ID. Stored so dedupe can key on it instead of
    // the title — a renamed call would otherwise look like a brand new meeting
    // and be reprocessed. Uniquely indexed, so the database refuses duplicates
    // even if the caller's own dedupe fails.
    const recording_id: string | number | undefined = payload.recording_id

    if (!title) {
      res.status(400).json({ error: 'Missing required field: title', received_keys: Object.keys(payload) })
      return
    }

    // Use whatever content is available — transcript preferred, summary as fallback
    const primaryContent = transcript || summary || null

    console.log(`[Meeting Ingest] Received — title: "${title}" | summary: ${summary?.length ?? 0} chars | transcript: ${transcript?.length ?? 0} chars`)

    // Insert meeting record — allow empty content (will be marked failed if nothing to process)
    const { data: meeting, error: insertError } = await supabase
      .from('meetings')
      .insert({
        title,
        meeting_date: date ?? null,
        duration_minutes: duration ? Math.round(Number(duration)) : null,
        attendees: attendees ?? null,
        fathom_summary: summary ?? null,
        fathom_action_items: action_items ?? null,
        full_transcript: primaryContent,
        processing_status: primaryContent ? 'pending' : 'failed',
        fathom_recording_id: recording_id != null ? String(recording_id) : null,
      })
      .select('id')
      .single()

    // 23505 = unique_violation. The recording is already stored, which is the
    // unique index doing its job — not an error. Answering 200 keeps the caller
    // from treating a correctly-prevented duplicate as a failure and retrying.
    if (insertError?.code === '23505') {
      console.log(`[Meeting Ingest] Already ingested (recording ${recording_id}) — skipping "${title}"`)
      res.status(200).json({ message: 'Already ingested — skipped', duplicate: true })
      return
    }

    if (insertError || !meeting) {
      console.error('[Meeting Ingest] Insert failed:', insertError?.message, insertError?.details, insertError?.hint)
      res.status(500).json({ error: 'Database insert failed', detail: insertError?.message, hint: insertError?.hint })
      return
    }

    // Acknowledge immediately
    res.status(202).json({ message: 'Meeting received — processing', meetingId: meeting.id })

    // Process asynchronously only if we have content to analyze
    if (primaryContent) {
      const meetingData: MeetingData = {
        title,
        date,
        duration,
        attendees,
        summary,
        action_items,
        transcript: primaryContent,
      }
      processMeeting(meeting.id as string, meetingData)
    } else {
      console.warn(`[Meeting Ingest] ${meeting.id}: No transcript or summary — stored without processing`)
    }
  })

  return router
}
