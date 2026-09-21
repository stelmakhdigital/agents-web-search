// src/index.ts
import { WebError as WebError2 } from "@deepseek-ai/dsh-web";

// src/config.ts
import z from "@deepseek-ai/schemastery";
function providerBlockSchema(explicitOnlyDefault) {
  return z.object({
    apiKey: z.string().default(""),
    apiKeyEnv: z.string().default(""),
    baseURL: z.string().default(""),
    model: z.string().default(""),
    /** 0 = use the core engine default (sentinel: per-engine core defaults differ). */
    maxUses: z.number().default(0),
    explicitOnly: z.boolean().default(explicitOnlyDefault)
  }).default({ apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: explicitOnlyDefault });
}
var Config = z.object({
  search: z.object({
    engines: z.array(z.string()).default(["ddg", "bing"]),
    mode: z.union(["fallback", "fuse"]).default("fallback"),
    region: z.string().default(""),
    freshness: z.string().default(""),
    rateLimitPerSec: z.number().default(1),
    timeoutMs: z.number().default(3e4),
    cacheTtlMs: z.number().default(9e5),
    enrich: z.object({
      enabled: z.boolean().default(true),
      fetchLimit: z.number().default(6),
      keep: z.number().default(5),
      fetchTimeoutMs: z.number().default(1e4)
    }).default({ enabled: true, fetchLimit: 6, keep: 5, fetchTimeoutMs: 1e4 }),
    embedEndpoint: z.string().default(""),
    embedModel: z.string().default(""),
    storePath: z.string().default("")
  }).default({
    engines: ["ddg", "bing"],
    mode: "fallback",
    region: "",
    freshness: "",
    rateLimitPerSec: 1,
    timeoutMs: 3e4,
    cacheTtlMs: 9e5,
    enrich: { enabled: true, fetchLimit: 6, keep: 5, fetchTimeoutMs: 1e4 },
    embedEndpoint: "",
    embedModel: "",
    storePath: ""
  }),
  fetch: z.object({
    cacheTtlMs: z.number().default(864e5),
    revalidate: z.boolean().default(true),
    maxOutputChars: z.number().default(1e5),
    timeoutMs: z.number().default(3e4),
    allowPrivateNetworks: z.boolean().default(false),
    pdf: z.object({
      enabled: z.boolean().default(true),
      maxSizeBytes: z.number().default(20 * 1024 * 1024),
      maxPages: z.number().default(50)
    }).default({ enabled: true, maxSizeBytes: 20 * 1024 * 1024, maxPages: 50 }),
    video: z.object({
      enabled: z.boolean().default(true)
    }).default({ enabled: true }),
    github: z.object({
      enabled: z.boolean().default(true),
      maxCloneBytes: z.number().default(200 * 1024 * 1024),
      maxTreeEntries: z.number().default(500)
    }).default({ enabled: true, maxCloneBytes: 200 * 1024 * 1024, maxTreeEntries: 500 })
  }).default({ cacheTtlMs: 864e5, revalidate: true, maxOutputChars: 1e5, timeoutMs: 3e4, allowPrivateNetworks: false, pdf: { enabled: true, maxSizeBytes: 20 * 1024 * 1024, maxPages: 50 }, video: { enabled: true }, github: { enabled: true, maxCloneBytes: 200 * 1024 * 1024, maxTreeEntries: 500 } }),
  platforms: z.object({
    enabled: z.boolean().default(true),
    maxResults: z.number().default(20),
    timeoutMs: z.number().default(3e4)
  }).default({ enabled: true, maxResults: 20, timeoutMs: 3e4 }),
  history: z.object({
    history: z.boolean().default(true),
    cacheClear: z.boolean().default(true),
    stats: z.boolean().default(true)
  }).default({ history: true, cacheClear: true, stats: true }),
  extended: z.object({
    curator: z.object({
      enabled: z.boolean().default(false),
      bind: z.string().default("127.0.0.1"),
      host: z.string().default("localhost"),
      remote: z.boolean().default(false)
    }).default({ enabled: false, bind: "127.0.0.1", host: "localhost", remote: false })
  }).default({ curator: { enabled: false, bind: "127.0.0.1", host: "localhost", remote: false } }),
  browser: z.object({
    enabled: z.boolean().default(false),
    headless: z.boolean().default(true),
    approval: z.union(["never", "navigate", "all"]).default("navigate"),
    allowPrivateNetworks: z.boolean().default(false),
    maxConcurrentTabs: z.number().default(1)
  }).default({ enabled: false, headless: true, approval: "navigate", allowPrivateNetworks: false, maxConcurrentTabs: 1 }),
  providers: z.object({
    openai: providerBlockSchema(false),
    xai: providerBlockSchema(true),
    anthropic: providerBlockSchema(false),
    deepseek: providerBlockSchema(false),
    gemini: providerBlockSchema(false),
    perplexity: providerBlockSchema(false),
    exa: providerBlockSchema(false),
    tavily: providerBlockSchema(false),
    brave: providerBlockSchema(false),
    jina: providerBlockSchema(false),
    searxng: z.object({ endpoint: z.string().default("") }).default({ endpoint: "" }),
    ollama: z.object({ endpoint: z.string().default("") }).default({ endpoint: "" })
  }).default({
    openai: { apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: false },
    xai: { apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: true },
    anthropic: { apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: false },
    deepseek: { apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: false },
    gemini: { apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: false },
    perplexity: { apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: false },
    exa: { apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: false },
    tavily: { apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: false },
    brave: { apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: false },
    jina: { apiKey: "", apiKeyEnv: "", baseURL: "", model: "", maxUses: 0, explicitOnly: false },
    searxng: { endpoint: "" },
    ollama: { endpoint: "" }
  })
});
function providerBlock(block, engine) {
  if (block === void 0) return void 0;
  const str = (value) => value !== void 0 && value !== "" ? value : void 0;
  const model = "model" in block ? str(block.model) : void 0;
  const rawMaxUses = "maxUses" in block ? block.maxUses : void 0;
  const maxUses = rawMaxUses !== void 0 && rawMaxUses > 0 ? rawMaxUses : void 0;
  const explicitOnly = "explicitOnly" in block ? block.explicitOnly : void 0;
  const out = {
    ...str(block.apiKey) !== void 0 ? { apiKey: str(block.apiKey) } : {},
    ...str(block.apiKeyEnv) !== void 0 ? { apiKeyEnv: str(block.apiKeyEnv) } : {},
    ...str(block.baseURL) !== void 0 ? { baseUrl: str(block.baseURL) } : {},
    ...model !== void 0 ? { model } : {},
    ...maxUses !== void 0 ? { maxUses } : {},
    ...explicitOnly !== void 0 && explicitOnly !== (engine === "xai") ? { explicitOnly } : {}
  };
  return Object.keys(out).length > 0 ? out : void 0;
}
function toCoreConfig(config) {
  const search = config.search ?? {};
  const fetch2 = config.fetch ?? {};
  const platforms = config.platforms ?? {};
  const extended = config.extended ?? {};
  const browser = config.browser ?? {};
  const providers = config.providers ?? {};
  const str = (value) => value !== void 0 && value !== "" ? value : void 0;
  const embedEndpoint = str(search.embedEndpoint);
  const core = {
    search: {
      ...search.engines !== void 0 && search.engines.length > 0 ? { engines: [...search.engines] } : {},
      ...search.mode !== void 0 ? { mode: search.mode } : {},
      ...str(search.region) !== void 0 ? { region: str(search.region) } : {},
      ...str(search.freshness) !== void 0 ? { freshness: str(search.freshness) } : {},
      ...search.rateLimitPerSec !== void 0 ? { rateLimitPerSec: search.rateLimitPerSec } : {},
      ...search.timeoutMs !== void 0 ? { timeoutMs: search.timeoutMs } : {},
      ...search.cacheTtlMs !== void 0 ? { cacheTtlMs: search.cacheTtlMs } : {},
      ...search.enrich !== void 0 ? {
        enrich: {
          ...search.enrich.enabled !== void 0 ? { enabled: search.enrich.enabled } : {},
          ...search.enrich.fetchLimit !== void 0 ? { fetchLimit: search.enrich.fetchLimit } : {},
          ...search.enrich.keep !== void 0 ? { keep: search.enrich.keep } : {},
          ...search.enrich.fetchTimeoutMs !== void 0 ? { fetchTimeoutMs: search.enrich.fetchTimeoutMs } : {}
        }
      } : {},
      ...embedEndpoint !== void 0 ? {
        embed: {
          endpoint: embedEndpoint,
          ...str(search.embedModel) !== void 0 ? { model: str(search.embedModel) } : {}
        }
      } : {}
    },
    fetch: {
      ...fetch2.cacheTtlMs !== void 0 ? { cacheTtlMs: fetch2.cacheTtlMs } : {},
      ...fetch2.revalidate !== void 0 ? { revalidate: fetch2.revalidate } : {},
      ...fetch2.maxOutputChars !== void 0 ? { maxOutputChars: fetch2.maxOutputChars } : {},
      ...fetch2.timeoutMs !== void 0 ? { timeoutMs: fetch2.timeoutMs } : {},
      ...fetch2.allowPrivateNetworks !== void 0 ? { allowPrivateNetworks: fetch2.allowPrivateNetworks } : {},
      ...fetch2.pdf !== void 0 ? {
        pdf: {
          ...fetch2.pdf.enabled !== void 0 ? { enabled: fetch2.pdf.enabled } : {},
          ...fetch2.pdf.maxSizeBytes !== void 0 ? { maxSizeBytes: fetch2.pdf.maxSizeBytes } : {},
          ...fetch2.pdf.maxPages !== void 0 ? { maxPages: fetch2.pdf.maxPages } : {}
        }
      } : {},
      ...fetch2.video !== void 0 ? { video: { enabled: fetch2.video.enabled } } : {},
      ...fetch2.github !== void 0 ? {
        github: {
          ...fetch2.github.enabled !== void 0 ? { enabled: fetch2.github.enabled } : {},
          ...fetch2.github.maxCloneBytes !== void 0 ? { maxCloneBytes: fetch2.github.maxCloneBytes } : {},
          ...fetch2.github.maxTreeEntries !== void 0 ? { maxTreeEntries: fetch2.github.maxTreeEntries } : {}
        }
      } : {}
    },
    platforms: {
      ...platforms.enabled !== void 0 ? { enabled: platforms.enabled } : {},
      ...platforms.maxResults !== void 0 ? { maxResults: platforms.maxResults } : {},
      ...platforms.timeoutMs !== void 0 ? { timeoutMs: platforms.timeoutMs } : {}
    },
    ...browser.enabled !== void 0 ? {
      browser: {
        enabled: browser.enabled,
        ...browser.headless !== void 0 ? { headless: browser.headless } : {},
        ...browser.approval !== void 0 ? { approval: browser.approval } : {},
        ...browser.allowPrivateNetworks !== void 0 ? { allowPrivateNetworks: browser.allowPrivateNetworks } : {},
        ...browser.maxConcurrentTabs !== void 0 ? { maxConcurrentTabs: browser.maxConcurrentTabs } : {}
      }
    } : {},
    ...extended.curator !== void 0 ? {
      extended: {
        curator: {
          enabled: extended.curator.enabled,
          ...str(extended.curator.bind) !== void 0 ? { bind: str(extended.curator.bind) } : {},
          ...str(extended.curator.host) !== void 0 ? { host: str(extended.curator.host) } : {},
          ...extended.curator.remote !== void 0 ? { remote: extended.curator.remote } : {}
        }
      }
    } : {},
    store: {
      ...str(search.storePath) !== void 0 ? { path: str(search.storePath) } : {}
    },
    providers: {
      ...providerBlock(providers.openai, "openai") !== void 0 ? { openai: providerBlock(providers.openai, "openai") } : {},
      ...providerBlock(providers.xai, "xai") !== void 0 ? { xai: providerBlock(providers.xai, "xai") } : {},
      ...providerBlock(providers.anthropic, "anthropic") !== void 0 ? { anthropic: providerBlock(providers.anthropic, "anthropic") } : {},
      ...providerBlock(providers.deepseek, "deepseek") !== void 0 ? { deepseek: providerBlock(providers.deepseek, "deepseek") } : {},
      ...providerBlock(providers.gemini, "gemini") !== void 0 ? { gemini: providerBlock(providers.gemini, "gemini") } : {},
      ...providerBlock(providers.perplexity, "perplexity") !== void 0 ? { perplexity: providerBlock(providers.perplexity, "perplexity") } : {},
      ...providerBlock(providers.exa, "exa") !== void 0 ? { exa: providerBlock(providers.exa, "exa") } : {},
      ...providerBlock(providers.tavily, "tavily") !== void 0 ? { tavily: providerBlock(providers.tavily, "tavily") } : {},
      ...providerBlock(providers.brave, "brave") !== void 0 ? { brave: providerBlock(providers.brave, "brave") } : {},
      ...providerBlock(providers.jina, "jina") !== void 0 ? { jina: providerBlock(providers.jina, "jina") } : {},
      ...str(providers.searxng?.endpoint) !== void 0 ? { searxng: { endpoint: str(providers.searxng?.endpoint) } } : {},
      ...str(providers.ollama?.endpoint) !== void 0 ? { ollama: { endpoint: str(providers.ollama?.endpoint) } } : {}
    }
  };
  return core;
}

// src/host.ts
import {
  CoreError,
  createWebStack
} from "@agents-web-search/core";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { WebError } from "@deepseek-ai/dsh-web";
import { dirname } from "node:path";

// src/llm.ts
var DEFAULT_BASE_URL = "https://api.deepseek.com";
var DEFAULT_MODEL = "deepseek-chat";
function createDshLlmClient() {
  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (apiKey === void 0 || apiKey.length === 0) return void 0;
  const baseUrl = (process.env["DEEPSEEK_BASE_URL"] ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    async complete({ prompt, model, maxTokens, signal }) {
      let response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: model ?? DEFAULT_MODEL,
            messages: [{ role: "user", content: prompt }],
            ...maxTokens !== void 0 ? { max_tokens: maxTokens } : {}
          }),
          signal
        });
      } catch (error) {
        throw new Error(`DeepSeek API request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`DeepSeek API returned HTTP ${response.status}: ${detail}`);
      }
      const json = await response.json();
      const text = typeof json.choices?.[0]?.message?.content === "string" ? json.choices[0].message.content : "";
      if (text.length === 0) throw new Error("DeepSeek API returned an empty completion");
      return {
        text,
        model: typeof json.model === "string" ? json.model : model ?? DEFAULT_MODEL,
        usage: { in: Number(json.usage?.prompt_tokens ?? 0), out: Number(json.usage?.completion_tokens ?? 0) }
      };
    }
  };
}

// src/schema.ts
function toDshValueSchema(node) {
  const description = node.description;
  switch (node.type) {
    case "string": {
      const enumValues = node.enum !== void 0 ? node.enum : void 0;
      return {
        type: "string",
        ...enumValues !== void 0 ? { enum: enumValues } : {},
        ...description !== void 0 ? { description } : {}
      };
    }
    case "number":
    case "integer":
      return { type: node.type, ...description !== void 0 ? { description } : {} };
    case "boolean":
      return { type: "boolean", ...description !== void 0 ? { description } : {} };
    case "null":
      return { type: "null", ...description !== void 0 ? { description } : {} };
    case "array":
      return {
        type: "array",
        ...node.items !== void 0 ? { items: toDshValueSchema(node.items) } : {},
        ...description !== void 0 ? { description } : {}
      };
    case "object":
      return {
        type: "object",
        ...node.properties !== void 0 ? { properties: toDshPropertySchema(node) } : {},
        // DSH requires an explicit openness flag; JSON Schema defaults to open.
        additionalProperties: node.additionalProperties === false ? false : true,
        ...description !== void 0 ? { description } : {}
      };
    default:
      if (node.oneOf !== void 0) {
        const branches = node.oneOf.map((oneOf) => toDshValueSchema(oneOf));
        if (branches.length < 2) {
          throw new Error("dsh adapter: oneOf requires at least two branches in tool parameters");
        }
        return {
          oneOf: [branches[0], branches[1], ...branches.slice(2)],
          ...description !== void 0 ? { description } : {}
        };
      }
      throw new Error(`dsh adapter: unsupported JSON Schema type ${String(node.type)} in tool parameters`);
  }
}
function toDshPropertySchema(objectNode) {
  const required = new Set(objectNode.required ?? []);
  const properties = objectNode.properties ?? {};
  const out = {};
  for (const [name2, prop] of Object.entries(properties)) {
    const converted = toDshValueSchema(prop);
    out[name2] = required.has(name2) ? { ...converted, required: true } : converted;
  }
  return out;
}
function toDshParameterSchema(schema) {
  if (schema.type !== void 0 && schema.type !== "object") {
    throw new Error("dsh adapter: tool parameters must be an object-rooted JSON Schema");
  }
  return toDshPropertySchema(schema);
}

// src/host.ts
var PLUGIN_NAME = "agents-web-search";
var SEARCH_PROVIDER_ID = "multi";
var FETCH_PROVIDER_ID = "cached-http";
var HOST_OWNED_TOOLS = /* @__PURE__ */ new Set(["web_search", "web_fetch"]);
var CONCURRENT_TOOLS = /* @__PURE__ */ new Set(["web_platform_search", "get_search_content", "web_history", "web_search_stats", "web_cache_clear"]);
var SETTINGS_NAMESPACE = "agents-web-search";
var CREDENTIAL_ENV_DEFAULTS = {
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  gemini: "GEMINI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  exa: "EXA_API_KEY",
  tavily: "TAVILY_API_KEY",
  brave: "BRAVE_API_KEY",
  jina: "JINA_API_KEY"
};
function toHostError(err) {
  if (err instanceof CoreError) {
    return new WebError(err.message, err.code, { cause: err.cause });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new WebError(message, "WEB_INTERNAL", { cause: err });
}
function outputError(text) {
  const match = /^Error \(([A-Z0-9_]+)\): ([\s\S]*)$/.exec(text);
  if (match !== null && match[1] !== void 0 && match[2] !== void 0) {
    return new WebError(match[2], match[1]);
  }
  return new WebError(text, "WEB_INTERNAL");
}
function buildDshWebStack(ctx, config) {
  const coreConfig = toCoreConfig(config);
  const stateDir = dirname(dshHomePath("web.db"));
  let currentExec;
  let stackRef;
  const host = {
    identity: { name: "dsh", version: "1.0.0" },
    // keep in sync with package.json (UA/logs/stats)
    config: coreConfig,
    paths: {
      stateDir,
      tempDir: `${stateDir}/web-search-temp`
    },
    // ADR-002 §6: explicit config literal (core layer) → credentials domain →
    // launch environment (both resolved here, per search) → process env (core).
    credential: async (name2) => {
      const engine = name2.replace(/^websearch:/, "");
      const configured = config.providers?.[engine]?.apiKeyEnv;
      const ref = configured ?? CREDENTIAL_ENV_DEFAULTS[engine];
      if (ref === void 0) return void 0;
      const credentials = ctx.get("credentials");
      if (credentials !== void 0) {
        const resolved = await credentials.resolve(credentialRef(ref));
        if (resolved !== void 0 && resolved.value.length > 0) return resolved.value;
      }
      const ambient = launchEnvironmentOf(ctx).get(ref);
      if (ambient !== void 0 && ambient.value.length > 0) return ambient.value;
      return void 0;
    },
    registerTools: (specs) => {
      const unregisters = [];
      for (const spec of specs) {
        if (HOST_OWNED_TOOLS.has(spec.name)) continue;
        const unregister = ctx.tools.register(defineTool({
          name: spec.name,
          description: spec.description,
          parameters: toDshParameterSchema(spec.parameters),
          output: {
            schema: { type: "json" },
            render: (_args, value) => [{ type: "text", text: value.text }]
          },
          isConcurrencySafe: () => CONCURRENT_TOOLS.has(spec.name),
          async execute(args, exec) {
            currentExec = exec;
            try {
              const out = await spec.execute(args, { signal: exec.signal });
              if (out.isError) throw outputError(out.text);
              return { text: out.text, ...out.details !== void 0 ? { details: out.details } : {} };
            } finally {
              currentExec = void 0;
            }
          }
        }));
        unregisters.push(unregister);
      }
      return () => {
        for (const unregister of unregisters) unregister();
      };
    },
    toHostError: (err) => toHostError(err),
    // ADR-005 §3: delegate to the host approval service; fail closed when the
    // service or the routing agent is unavailable (denied, not allowed).
    approve: async (request) => {
      const exec = currentExec;
      if (exec === void 0 || exec.agent === void 0) {
        throw new CoreError(
          "approval is required, but the call has no agent to route it through",
          "BROWSER_APPROVAL_UNAVAILABLE"
        );
      }
      const approver = ctx.get("approval");
      if (approver === void 0) {
        throw new CoreError(
          'the DSH approval service is unavailable; set browser.approval to "never" to disable gating',
          "BROWSER_APPROVAL_UNAVAILABLE"
        );
      }
      const outcome = await approver.request({
        agent: exec.agent,
        toolName: request.kind,
        callId: exec.callId,
        reason: request.description,
        signal: exec.signal
      });
      return outcome === "allowed-once";
    },
    log: (level, message, meta) => {
      const logger = ctx.logger;
      if (logger === void 0) return;
      const args = meta !== void 0 ? [meta] : [];
      switch (level) {
        case "debug":
          logger.debug(message, ...args);
          break;
        case "info":
          logger.info(message, ...args);
          break;
        case "warn":
          logger.warn(message, ...args);
          break;
        case "error":
          logger.error(message, ...args);
          break;
      }
    },
    // Roadmap 5.4: auxiliary LLM (curator summaries, web_fetch question mode).
    // DEEPSEEK_API_KEY (env) → DeepSeek chat-completions; undefined (fail-closed)
    // when the key is absent.
    llm: createDshLlmClient(),
    dispose: async () => {
      void stackRef.dispose();
    }
  };
  const stack = createWebStack(host);
  stackRef = stack;
  const disposeTools = host.registerTools(stack.tools());
  const withExec = (exec, fn) => {
    const previous = currentExec;
    currentExec = exec;
    try {
      return fn();
    } finally {
      currentExec = previous;
    }
  };
  return { stack, host, withExec, disposeTools };
}

// src/index.ts
var name = PLUGIN_NAME;
var inject = ["web", "tools", "systemPrompt"];
function seamSource(source) {
  return {
    url: source.url,
    ...source.title !== void 0 ? { title: source.title } : {},
    ...source.snippet !== void 0 ? { snippet: source.snippet } : {},
    ...source.publishedAt !== void 0 ? { publishedAt: source.publishedAt } : {}
  };
}
function seamFetch(result) {
  return {
    url: result.url,
    statusCode: result.statusCode,
    body: { kind: result.body.kind, content: result.body.content },
    truncated: result.truncated
  };
}
function apply(ctx, config) {
  const searchMode = config.search?.mode;
  if (searchMode !== void 0 && searchMode !== "fallback" && searchMode !== "fuse") {
    throw new Error(`agents-web-search: search.mode must be "fallback" or "fuse", got "${searchMode}"`);
  }
  toCoreConfig(config);
  const { stack, disposeTools } = buildDshWebStack(ctx, config);
  const searchProvider = {
    id: SEARCH_PROVIDER_ID,
    available: () => true,
    // the keyless engines (ddg/bing) always make the stack usable
    search: async (request, signal) => {
      try {
        const result = await stack.search(
          { query: request.query, ...request.maxResults !== void 0 ? { maxResults: request.maxResults } : {} },
          signal
        );
        return {
          ...result.content !== void 0 ? { content: result.content } : {},
          sources: result.sources.map(seamSource),
          truncated: result.truncated
        };
      } catch (error) {
        throw toHostError(error);
      }
    }
  };
  const fetchProvider = {
    id: FETCH_PROVIDER_ID,
    available: () => true,
    fetch: async (request, signal) => {
      try {
        return seamFetch(await stack.fetch({ url: request.url }, signal));
      } catch (error) {
        throw toHostError(error);
      }
    }
  };
  try {
    ctx.web.registerSearchProvider(searchProvider);
  } catch (error) {
    if (error instanceof WebError2 && error.code === "WEB_DUPLICATE_PROVIDER") {
      throw new WebError2(
        'the "multi" search provider is already registered: the @agents-web-search/dsh plugin is loaded twice (double install) \u2014 remove the duplicate install. (The built-in DSH web packages use different provider ids, e.g. "http"/"deepseek", and do NOT cause this error: the plugin bundle pins the seam to searchProvider=multi/fetchProvider=cached-http, so built-in providers may coexist.)',
        "WEB_DUPLICATE_PROVIDER",
        { cause: error }
      );
    }
    throw error;
  }
  ctx.web.registerFetchProvider(fetchProvider);
  ctx.systemPrompt.section({
    name: "tool:agents_web_search",
    order: 116,
    text: "Use web_platform_search for platform-specific searches (GitHub, Reddit, YouTube, \u2026), get_search_content to read the full cached content of a previous web_search/web_fetch result (by the record id printed in their output), web_history to review recent web searches and fetches, web_search_stats for web storage statistics, and web_cache_clear to clear the web search/page cache. These tools read the shared local web store; they make no network requests (except web_platform_search)."
  });
  let currentSource = () => config;
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        currentSource = source;
      },
      onChange: () => {
        ctx.logger?.info("agents-web-search: config changed; it applies at the next launch");
      }
    });
  });
  void currentSource;
  ctx.effect(
    function* () {
      yield () => {
        disposeTools();
        void stack.dispose();
      };
    },
    "agents-web-search.dispose()"
  );
}
export {
  Config,
  FETCH_PROVIDER_ID,
  SEARCH_PROVIDER_ID,
  SETTINGS_NAMESPACE,
  apply,
  inject,
  name,
  toHostError
};
