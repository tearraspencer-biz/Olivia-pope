import { createClient } from '@supabase/supabase-js'
import type { ResearchResult } from './claude.js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

export async function saveResearch(
  result: ResearchResult,
  originalQuery: string
): Promise<string | null> {
  try {
    // 1. Create research task
    const { data: task, error: taskError } = await supabase
      .from('research_tasks')
      .insert({
        title: result.title,
        status: 'complete',
        prompt_used: originalQuery,
      })
      .select()
      .single()

    if (taskError || !task) {
      console.error('Failed to create research task:', taskError)
      return null
    }

    // 2. Look up category by name
    const { data: category } = await supabase
      .from('categories')
      .select('id')
      .eq('name', result.category)
      .single()

    // 3. Create research output
    const { data: output, error: outputError } = await supabase
      .from('research_outputs')
      .insert({
        task_id: task.id,
        category_id: category?.id ?? null,
        title: result.title,
        summary: result.summary,
        full_text: result.full_text,
        source_notes: result.source_notes ?? null,
        is_starred: false,
        is_archived: false,
      })
      .select()
      .single()

    if (outputError || !output) {
      console.error('Failed to create research output:', outputError)
      return null
    }

    // 4. Handle tags — upsert each, then link to output
    for (const tagName of result.tags) {
      const slug = tagName
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')

      if (!slug) continue

      const { data: tag, error: tagError } = await supabase
        .from('tags')
        .upsert({ name: tagName, slug }, { onConflict: 'slug' })
        .select()
        .single()

      if (tagError || !tag) {
        console.warn(`Skipping tag "${tagName}":`, tagError)
        continue
      }

      const { error: junctionError } = await supabase
        .from('research_output_tags')
        .insert({ output_id: output.id, tag_id: tag.id })

      if (junctionError) {
        console.warn(`Failed to link tag "${tagName}":`, junctionError)
      }
    }

    return output.id as string
  } catch (err) {
    console.error('saveResearch error:', err)
    return null
  }
}
