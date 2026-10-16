# Olivia MCP — deployed connection

This adds `/mcp` to the existing Olivia server. It reuses the existing Olivia
Supabase library and Content HQ records. It is deployed on the existing Olivia Railway service.
ChatGPT authorization remains pending exact callback verification and owner consent.
See Content HQ docs/unified-social-agent.md for the release record.

## Tools

- `search`: calls existing `knowledge-search` with `scope: all`.
- `fetch`: reads a stored source in pages with its date, coverage and provenance.
- `list_content_engines`: reads the caller's existing Content HQ audiences.
- `save_content_draft`: creates an unapproved draft or revision in Content HQ.
  Retry with the same request ID. Video input must match the existing production
  package described by the tool schema. Revisions preserve parent and feedback.

Search covers stored meetings/personal/coaching calls, video transcripts,
research reports and extracted lessons. It does not fetch external content
that was never ingested. New and edited rows become searchable automatically
after the library migration. Originals use keyword search; extracted lessons
also use the existing semantic search when available. Summary-only calls are
explicitly labeled. A source being stored does not prove its transcript is complete.

## Deployment order and maintenance reference

1. Verify Olivia owner sign-in, then review and apply the existing owner-access
   policies and the pre-existing `20261015000001_remove_open_access.sql` migration.
   The audit found old permissive policies that still permit anonymous reads.
   Do not expose personal source retrieval while that remains unresolved.
2. Apply Olivia's `202610160002_full_source_search.sql`; deploy the updated
   `knowledge-search` with its shared files and existing owner/agent secrets.
   Legacy callers retain lesson-only behavior unless they request `scope: all`.
3. Apply Content HQ migrations `202610160001_generation_context.sql` and
   `202610160003_mcp_drafts_and_oauth.sql`. Deploy its consent/source-reader
   pages and generation integration to the existing Content HQ app.
4. Set the Olivia source URLs, owner binding and
   `OLIVIA_USE_CONTENT_HQ_SESSION=true` in Content HQ. Its existing signed-in
   owner token is verified by Olivia; no shared agent key is needed in Vercel.
   Olivia pins `CONTENT_HQ_AUTH_URL`, `CONTENT_HQ_AUTH_PUBLIC_KEY` and
   `CONTENT_HQ_OWNER_ID` in its existing server secret store.
5. Enable the existing Content HQ Supabase OAuth server, set its consent path
   to `/oauth/consent`, and verify asymmetric JWT signing with public JWKS.
   Do not blindly rotate keys or overwrite an existing access-token hook.
6. Register the ChatGPT OAuth client using the exact callback URI supplied by
   its connection setup. Require PKCE. Configure the client ID in both
   `olivia_mcp_oauth_resources` and `MCP_OAUTH_CLIENT_IDS`. The resource URL must
   match `MCP_PUBLIC_URL` exactly. The database hook binds the token audience
   and assigns the restricted `content_hq_mcp` role. Enable that hook only after
   reviewing any existing hook configuration.
7. Configure the existing Olivia server using `.env.example` and release this
   code. Use Content HQ's public Supabase key and the owner's Content HQ user
   ID; no Content HQ service-role key is needed. Keep `OLIVIA_AGENT_KEY` server-side.
8. Complete the owner's explicit ChatGPT OAuth consent. Test a real search,
   paged fetch, draft save, retry and feedback revision. Verify the resulting
   draft in Content HQ and deny direct approval/delete requests using the
   same OAuth token. Verify expired, wrong-owner and unregistered-client denial.

Metadata lives at `/.well-known/oauth-protected-resource/mcp`. JWT validation
pins issuer, audience, algorithm, owner, client and role; requests also check
the current Supabase user. The production Supabase `/user` behavior with the
restricted OAuth token still needs an end-to-end check.

## Review and limits

The MCP database role cannot approve, schedule, delete, or directly edit content
tables. It can select owned engine names and execute the narrow draft RPC.
No publishing tool exists. Source references are saved as metadata rather than
copying transcripts to a second library. Private passages are returned to the
authorized AI client, so the consent page explicitly describes this access.

Instructions prohibit publishing identifying combinations or presenting another
person's experience as Tearra's. The write guard blocks known participant names,
email addresses and SSN-shaped strings. It cannot prove anonymization; review
is still required. Saved research requires fresh verification for current facts.

`npm test` compiles TypeScript and runs auth, protocol, source and draft tests.
Local tests use fixtures; they do not establish production OAuth connectivity,
publishing capability, or quality of generated content.
