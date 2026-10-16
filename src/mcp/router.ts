import express, { type RequestHandler } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mcpConfig, tokenVerifier, type McpConfig } from './auth.js'
import { buildMcpServer } from './tools.js'

export function createMcpRouter(config?: McpConfig | null, verify?: (token: string) => Promise<unknown>, fetcher: typeof fetch = fetch) {
  const router = express.Router()
  let resolved: McpConfig | null = null
  try { resolved = config === undefined ? mcpConfig() : config } catch { /* fail closed; existing bot can still run */ }
  const metadata = (_req: express.Request, res: express.Response) => resolved
    ? res.json({ resource: resolved.resource, authorization_servers: [resolved.issuer], scopes_supported: ['openid'], bearer_methods_supported: ['header'], resource_name: 'Olivia knowledge and Content HQ drafts' })
    : res.status(503).json({ error: 'MCP is not configured.' })
  router.get('/.well-known/oauth-protected-resource', metadata)
  router.get('/.well-known/oauth-protected-resource/mcp', metadata)
  const verifier = resolved ? verify ?? tokenVerifier(resolved) : null
  const recent = new Map<string, { since: number; calls: number }>()
  const authenticate: RequestHandler = async (req, res, next) => {
    if (!resolved || !verifier) { res.status(503).json({ error: 'MCP is not configured.' }); return }
    const config = resolved
    const origin = req.get('origin')
    const origins = [new URL(config.resource).origin, new URL(config.contentHqUrl).origin, 'https://chatgpt.com', ...config.allowedOrigins]
    if (origin && !origins.includes(origin)) { res.status(403).json({ error: 'Origin not allowed.' }); return }
    if (req.get('host') !== new URL(config.resource).host) { res.status(403).json({ error: 'Host not allowed.' }); return }
    if (origin) { res.set('Access-Control-Allow-Origin', origin); res.vary('Origin') }
    res.set('Cache-Control', 'no-store')
    const token = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') ?? '')?.[1]
    let stage = 'bearer_header'
    let issuerStatus: number | undefined
    try {
      if (!token || token.length > 16000) throw new Error()
      stage = 'jwt_validation'
      await verifier(token)
      stage = 'issuer_user_check'
      const user = await fetcher(`${config.issuer}/user`, { headers: { apikey: config.publicKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) })
      issuerStatus = user.status
      if (!user.ok || (await user.json()).id !== config.ownerId) throw new Error()
      const now = Date.now(), window = recent.get(config.ownerId)
      const bucket = !window || now - window.since > 60000 ? { since: now, calls: 0 } : window
      recent.set(config.ownerId, bucket)
      if (++bucket.calls > 60) { res.set('Retry-After', '60').status(429).json({ error: 'Please wait before trying again.' }); return }
      res.locals.mcpToken = token
      next()
    } catch (error) {
      // Never log the token, claims, identity, upstream body or raw message.
      // Only known diagnostic codes distinguish the failing boundary.
      const candidate = error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.message : ''
      const code = /^(ERR_JWT_[A-Z_]+|ERR_JWS_[A-Z_]+|ERR_JWKS_[A-Z_]+|ERR_JOSE_[A-Z_]+|MCP_(OWNER|ROLE|CLIENT)_MISMATCH)$/.test(candidate) ? candidate : 'AUTH_CHECK_FAILED'
      const claim = error && typeof error === 'object' && 'claim' in error && ['aud', 'iss', 'exp', 'iat', 'sub'].includes(String(error.claim)) ? String(error.claim) : undefined
      if (token) console.warn('MCP authorization rejected', { stage, code, claim, issuerStatus })
      const metadataUrl = `${new URL(config.resource).origin}/.well-known/oauth-protected-resource/mcp`
      res.set('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}", scope="openid"`).status(401).json({ error: 'Connect your authorized Content HQ account.' })
    }
  }
  router.options('/mcp', (req, res) => {
    const origin = req.get('origin')
    if (resolved && origin && [new URL(resolved.resource).origin, new URL(resolved.contentHqUrl).origin, 'https://chatgpt.com', ...resolved.allowedOrigins].includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin); res.vary('Origin')
    }
    res.set('Access-Control-Allow-Headers', 'authorization, content-type, mcp-protocol-version, mcp-session-id').set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS').sendStatus(204)
  })
  router.post('/mcp', authenticate, express.json({ limit: '64kb' }), async (req, res) => {
    const server = buildMcpServer(resolved!, res.locals.mcpToken, fetcher)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { void transport.close(); void server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' })
    }
  })
  router.get('/mcp', authenticate, (_req, res) => { res.set('Allow', 'POST, OPTIONS').status(405).json({ error: 'Use POST.' }) })
  router.delete('/mcp', authenticate, (_req, res) => { res.status(405).json({ error: 'This server uses stateless requests.' }) })
  router.use('/mcp', (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid MCP request.' })
  })
  return router
}
