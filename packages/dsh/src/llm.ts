/**
 * The DSH `HostAdapter.llm` implementation (roadmap 5.4): a minimal
 * DeepSeek chat-completions client for AUXILIARY generation only (curator
 * summaries, `web_fetch` question mode). The API key comes from the DSH
 * credential environment (`DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL` —
 * the same env contract the host's `llm-deepseek` adapter uses).
 *
 * Without a configured key the adapter returns `undefined` and the core's
 * LLM-dependent paths fail closed (`WEB_NOT_AVAILABLE`).
 * @module @agents-web-search/dsh/llm
 */

import type { LlmClient } from '@agents-web-search/core'

/** The public DeepSeek API endpoint (env-overridable). */
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
/** The default auxiliary model. */
const DEFAULT_MODEL = 'deepseek-chat'

/**
 * Build the DSH LLM client, or `undefined` when no `DEEPSEEK_API_KEY` is set.
 * @returns the client (or undefined — fail-closed).
 */
export function createDshLlmClient(): LlmClient | undefined {
  const apiKey = process.env['DEEPSEEK_API_KEY']
  if (apiKey === undefined || apiKey.length === 0) return undefined
  const baseUrl = (process.env['DEEPSEEK_BASE_URL'] ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  return {
    async complete({ prompt, model, maxTokens, signal }) {
      let response: Response
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: model ?? DEFAULT_MODEL,
            messages: [{ role: 'user', content: prompt }],
            ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
          }),
          signal,
        })
      } catch (error: unknown) {
        throw new Error(`DeepSeek API request failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300)
        throw new Error(`DeepSeek API returned HTTP ${response.status}: ${detail}`)
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
        model?: unknown
      }
      const text = typeof json.choices?.[0]?.message?.content === 'string' ? json.choices[0].message!.content! : ''
      if (text.length === 0) throw new Error('DeepSeek API returned an empty completion')
      return {
        text,
        model: typeof json.model === 'string' ? json.model : (model ?? DEFAULT_MODEL),
        usage: { in: Number(json.usage?.prompt_tokens ?? 0), out: Number(json.usage?.completion_tokens ?? 0) },
      }
    },
  }
}
