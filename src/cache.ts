import { createClient } from '@supabase/supabase-js'

// Service role, like every other Olivia client. Categories and projects are
// owner-only since 20261015000001_remove_open_access: the anon key now reads
// an empty list, and every research run then failed on "category_id does not
// match any known category" — the daily brief included.
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface CategoryRecord {
  id: string
  name: string
  slug: string
}

export interface ProjectRecord {
  id: string
  name: string
  slug: string
}

let categories: CategoryRecord[] = []
let projects: ProjectRecord[] = []
let lastRefresh = 0
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

export async function getCache(): Promise<{
  categories: CategoryRecord[]
  projects: ProjectRecord[]
}> {
  if (Date.now() - lastRefresh > CACHE_TTL || categories.length === 0) {
    await refreshCache()
  }
  return { categories, projects }
}

export async function refreshCache(): Promise<void> {
  const [catResult, projResult] = await Promise.all([
    supabase.from('categories').select('id, name, slug'),
    supabase.from('projects').select('id, name, slug').eq('is_active', true),
  ])

  if (catResult.data) categories = catResult.data
  if (projResult.data) projects = projResult.data
  lastRefresh = Date.now()

  console.log(
    `Cache refreshed: ${categories.length} categories, ${projects.length} projects`
  )
}
