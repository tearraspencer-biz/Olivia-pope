import type { Router, Request, Response } from 'express'
import { Router as createRouter } from 'express'
import { createClient } from '@supabase/supabase-js'
import { runResearch, structureResearch, structurePeopleResearch } from '../services/claude.js'
import { saveResearch } from '../services/supabase.js'
import { getCache } from '../cache.js'
import { buildResearchTopic, enforcePersonTags } from '../handlers/person.js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const OLIVIA_API_KEY = process.env.OLIVIA_API_KEY

// ── Status helpers ───────────────────────────────────────────────────────────

async function updateRequestStatus(
  requestId: string,
  status: 'pending' | 'processing' | 'complete' | 'failed',
  outputId?: string | null,
  errorMessage?: string | null
): Promise<void> {
  const { error } = await supabase
    .from('research_requests')
    .update({
      status,
      output_id: outputId ?? null,
      error_message: errorMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)

  if (error) {
    console.error(`[API] updateRequestStatus(${requestId}, ${status}) error:`, error.message)
  }
}

// ── Async research processor ─────────────────────────────────────────────────

async function processResearchRequest(
  requestId: string,
  requestType: 'research' | 'person',
  topic: string,
  focus: string | null
): Promise<void> {
  console.log(`[API] Processing request ${requestId} — type=${requestType}, topic=${topic}`)

  try {
    await updateRequestStatus(requestId, 'processing')

    // Build the prompt
    const researchPrompt =
      requestType === 'person'
        ? buildResearchTopic(topic, focus)
        : topic

    // Step 1: Research
    console.log(`[API] Running research for ${requestId}`)
    const researchOutput = await runResearch(researchPrompt)

    // Step 2: Structure
    console.log(`[API] Structuring output for ${requestId}`)
    const { categories, projects } = await getCache()

    let structured
    if (requestType === 'person') {
      structured = await structurePeopleResearch(topic, focus, researchOutput, categories, projects)
      structured.tags = enforcePersonTags(structured.tags ?? [], topic)
    } else {
      structured = await structureResearch(topic, researchOutput, categories, projects)
    }

    // Step 3: Save
    console.log(`[API] Saving to Supabase for ${requestId}`)
    const result = await saveResearch(structured, topic, categories, projects)

    await updateRequestStatus(requestId, 'complete', result.outputId)
    console.log(`[API] Request ${requestId} complete — output ${result.outputId}`)
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown error'
    console.error(`[API] Request ${requestId} failed:`, msg)
    await updateRequestStatus(
      requestId,
      'failed',
      null,
      'Research could not be completed. Please try again.'
    )
  }
}

// ── Router ───────────────────────────────────────────────────────────────────

export function createResearchRequestRouter(): Router {
  const router = createRouter()

  router.post('/api/research-request', async (req: Request, res: Response) => {
    // Validate API key
    const apiKey = req.headers['x-api-key']
    if (!OLIVIA_API_KEY || apiKey !== OLIVIA_API_KEY) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const { requestId, requestType, topic, focus } = req.body as {
      requestId?: string
      requestType?: string
      topic?: string
      focus?: string | null
    }

    if (!requestId || !requestType || !topic) {
      res.status(400).json({ error: 'Missing required fields: requestId, requestType, topic' })
      return
    }

    if (requestType !== 'research' && requestType !== 'person') {
      res.status(400).json({ error: 'requestType must be "research" or "person"' })
      return
    }

    // Acknowledge immediately — do not make dashboard wait for research
    res.status(202).json({ message: 'Request received', requestId })

    // Process asynchronously
    processResearchRequest(requestId, requestType, topic, focus ?? null)
  })

  return router
}
