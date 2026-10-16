import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

export type McpConfig = {
  resource: string; issuer: string; authBase: string; ownerId: string;
  clientIds: string[]; publicKey: string; knowledgeUrl: string;
  agentKey: string; oliviaAnonKey?: string;
  contentHqUrl: string; allowedOrigins: string[];
}
const httpsUrl = (value: string | undefined, label: string) => {
  if (!value) throw new Error(`Missing ${label}`)
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`Invalid ${label}`)
  return url.href.replace(/\/$/, '')
}
export function mcpConfig(env = process.env): McpConfig | null {
  if (!env.MCP_PUBLIC_URL) return null
  const resource = httpsUrl(env.MCP_PUBLIC_URL, 'MCP_PUBLIC_URL')
  if (!resource.endsWith('/mcp')) throw new Error('MCP_PUBLIC_URL must end in /mcp')
  const authBase = httpsUrl(env.CONTENT_HQ_SUPABASE_URL, 'CONTENT_HQ_SUPABASE_URL')
  const knowledgeUrl = httpsUrl(env.OLIVIA_KNOWLEDGE_URL, 'OLIVIA_KNOWLEDGE_URL')
  if (!knowledgeUrl.endsWith('/functions/v1/knowledge-search')) throw new Error('Invalid knowledge endpoint')
  const ownerId = env.MCP_OWNER_ID ?? ''
  const clientIds = (env.MCP_OAUTH_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!/^[0-9a-f-]{36}$/i.test(ownerId) || !clientIds.length || !env.CONTENT_HQ_SUPABASE_PUBLIC_KEY || !env.OLIVIA_AGENT_KEY) throw new Error('Incomplete MCP authorization configuration')
  return { resource, authBase, issuer: `${authBase}/auth/v1`, ownerId, clientIds,
    publicKey: env.CONTENT_HQ_SUPABASE_PUBLIC_KEY, knowledgeUrl, agentKey: env.OLIVIA_AGENT_KEY,
    oliviaAnonKey: env.OLIVIA_KNOWLEDGE_ANON_KEY,
    contentHqUrl: httpsUrl(env.CONTENT_HQ_URL, 'CONTENT_HQ_URL'),
    allowedOrigins: (env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  }
}

export function tokenVerifier(config: McpConfig, key?: JWTVerifyGetKey) {
  const jwks = key ?? createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`))
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, { issuer: config.issuer, audience: config.resource, algorithms: ['ES256', 'RS256'], requiredClaims: ['exp', 'iat', 'sub'], maxTokenAge: '2h' })
    if (payload.sub !== config.ownerId || payload.role !== 'content_hq_mcp' || typeof payload.client_id !== 'string' || !config.clientIds.includes(payload.client_id)) throw new Error('Not authorized')
    // Check revocation/current user with the issuer too, rather than accepting
    // any still-cryptographically-valid token after its account is disabled.
    return payload
  }
}
