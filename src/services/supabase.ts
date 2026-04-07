import { createClient } from '@supabase/supabase-js'
import type { StructuredResearch } from './claude.js'
import type { CategoryRecord, ProjectRecord } from '../cache.js'

// Service role client for all writes — bypasses RLS
const writeClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface SaveResult {
  outputId: string
  categoryName: string
  projectName: string | null
  tags: string[]
  summary: string
  outputTitle: string
}

export async function saveResearch(
  structured: StructuredResearch,
  originalQuery: string,
  categories: CategoryRecord[],
  projects: ProjectRecord[]
): Promise<SaveResult> {
  // Step 1 — Insert research task
  const { data: task, error: taskError } = await writeClient
    .from('research_tasks')
    .insert({
      title: structured.task_title,
      prompt_used: originalQuery,
      category_id: structured.category_id,
      project_id: structured.project_id || null,
      status: 'complete',
    })
    .select()
    .single()

  if (taskError || !task) {
    throw new Error('Task insert failed')
  }

  // Step 2 — Resolve or create tags
  const tagIds: string[] = []
  for (const tagName of structured.tags ?? []) {
    const slug = slugify(tagName)
    if (!slug) continue

    const { data: existing } = await writeClient
      .from('tags')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (existing) {
      tagIds.push(existing.id)
    } else {
      const { data: newTag, error: tagCreateError } = await writeClient
        .from('tags')
        .insert({ name: tagName, slug })
        .select()
        .single()

      if (tagCreateError || !newTag) {
        console.warn(`Could not create tag "${tagName}":`, tagCreateError?.message)
        continue
      }
      tagIds.push(newTag.id)
    }
  }

  // Step 3 — Insert research output
  const { data: output, error: outputError } = await writeClient
    .from('research_outputs')
    .insert({
      task_id: task.id,
      title: structured.output_title,
      summary: structured.summary,
      full_text: structured.full_text,
      plain_language_breakdown: structured.plain_language_breakdown || null,
      source_notes: structured.source_notes || null,
      category_id: structured.category_id,
      project_id: structured.project_id || null,
      is_starred: false,
      is_archived: false,
    })
    .select()
    .single()

  if (outputError || !output) {
    throw new Error('Output insert failed')
  }

  // Step 4 — Insert tag junction records
  if (tagIds.length > 0) {
    const junctions = tagIds.map((tagId) => ({ output_id: output.id, tag_id: tagId }))
    const { error: junctionError } = await writeClient
      .from('research_output_tags')
      .insert(junctions)

    if (junctionError) {
      throw new Error('Tag junction insert failed')
    }
  }

  // Step 5 — Resolve names for confirmation message
  const category = categories.find((c) => c.id === structured.category_id)
  const project = structured.project_id
    ? projects.find((p) => p.id === structured.project_id)
    : null

  return {
    outputId: output.id as string,
    categoryName: category?.name ?? 'Other',
    projectName: project?.name ?? null,
    tags: structured.tags ?? [],
    summary: structured.summary,
    outputTitle: structured.output_title,
  }
}
