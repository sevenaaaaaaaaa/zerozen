(function () {
  const ZZ = globalThis.ZZ;
  const F = ZZ.RuleFormat;

  const PRESETS = [
    { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyHint: "sk-..." },
    { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", keyHint: "sk-..." },
    { id: "zhipu", label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", keyHint: "..." },
    { id: "qwen", label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", keyHint: "sk-..." },
    { id: "moonshot", label: "月之暗面", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", keyHint: "sk-..." },
    { id: "siliconflow", label: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct", keyHint: "sk-..." },
    { id: "ollama", label: "本地 Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b", keyHint: "可留空" },
    { id: "custom", label: "自定义", baseUrl: "", model: "", keyHint: "" },
  ];

  function endpoint(baseUrl) {
    const base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) return "";
    if (/\/chat\/completions$/.test(base)) return base;
    return base + "/chat/completions";
  }

  function sanitize(text, settings) {
    let out = String(text || "");
    const key = settings && settings.ai && settings.ai.apiKey;
    if (key) out = out.split(key).join("***");
    return out.slice(0, 400);
  }

  function extractJson(text) {
    let s = String(text || "").trim();
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const slice = s.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (e) {
      try {
        return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
      } catch (e2) {
        return null;
      }
    }
  }

  function candidateSig(host, c) {
    return [
      host,
      c.tag || "",
      (c.id || "").slice(0, 40),
      (c.cls || []).slice(0, 3).join("."),
      (c.gen || "").slice(0, 60),
    ].join("|");
  }

  async function chat(messages, settings, opts) {
    const ai = settings.ai || {};
    const url = endpoint(ai.baseUrl);
    if (!url) return { ok: false, error: "未配置 API 地址" };
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutMs = Math.max(5000, Math.min(ai.timeoutMs || 30000, 120000));
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const headers = { "Content-Type": "application/json" };
    if (ai.apiKey) headers.Authorization = "Bearer " + ai.apiKey;
    const body = {
      model: ai.model || "gpt-4o-mini",
      messages,
      temperature: 0,
      max_tokens: (opts && opts.maxTokens) || 1500,
      stream: false,
    };
    if (!(opts && opts.noJsonMode)) body.response_format = { type: "json_object" };
    const started = Date.now();
    try {
      let res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
      let json = null;
      let text = "";
      try {
        text = await res.text();
        json = JSON.parse(text);
      } catch (e) {
        json = null;
      }
      if (!res.ok && res.status === 400 && body.response_format) {
        const retry = await chat(messages, settings, Object.assign({}, opts, { noJsonMode: true }));
        return retry;
      }
      if (!res.ok) {
        const detail = json && json.error ? json.error.message || JSON.stringify(json.error) : text;
        return { ok: false, status: res.status, error: sanitize(detail, settings) };
      }
      const content =
        json && json.choices && json.choices[0] && json.choices[0].message
          ? json.choices[0].message.content
          : "";
      const usage = (json && json.usage) || null;
      return { ok: true, content, usage, ms: Date.now() - started };
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      return { ok: false, error: aborted ? "请求超时" : sanitize(e && e.message, settings) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const Ai = {
    PRESETS,

    configured() {
      const ai = ZZ.Store.settings().ai || {};
      if (!ai.enabled) return false;
      if (!ai.baseUrl) return false;
      const local = /127\.0\.0\.1|localhost/.test(ai.baseUrl);
      return !!ai.apiKey || local;
    },

    sig: candidateSig,

    normalizeResult(raw, candidate, host) {
      if (!raw || raw.ad !== true) return null;
      let confidence = Number(raw.confidence);
      if (!isFinite(confidence)) confidence = 0.6;
      confidence = Math.max(0, Math.min(1, confidence));
      let selector = raw.selector ? F.cleanSelector(raw.selector) : "";
      let fallback = false;
      if (selector && F.validateSelector(selector)) selector = "";
      if (!selector) {
        selector = candidate.gen || candidate.sel || "";
        if (selector && F.validateSelector(selector)) selector = "";
        else fallback = !!selector;
        confidence = Math.max(0, confidence - 0.2);
      }
      if (!selector) return null;
      const blockDomain = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(String(raw.blockDomain || ""))
        ? String(raw.blockDomain).toLowerCase()
        : "";
      return {
        host,
        selector,
        genericSelector: raw.generic === true ? selector : "",
        generic: raw.generic === true,
        category: ZZ.AiPrompt.CATEGORIES.includes(raw.category) ? raw.category : "other",
        confidence,
        reason: String(raw.reason || "").slice(0, 120),
        blockDomain,
        fallback,
        candidate,
      };
    },

    async classify(opts) {
      const settings = ZZ.Store.settings();
      const ai = settings.ai || {};
      if (!ai.enabled) return { ok: false, error: "AI 识别未启用" };
      const host = opts.host;
      const candidates = (opts.candidates || []).slice(0, Math.max(1, ai.maxCandidates || 30));
      if (!candidates.length) return { ok: true, findings: [], cached: 0, calls: 0 };
      const cache = ZZ.Store.aiCache();
      const cachedMap = {};
      const pending = [];
      for (const c of candidates) {
        const key = candidateSig(host, c);
        const hit = cache[key];
        if (hit && Date.now() - hit.at < 1000 * 60 * 60 * 24 * 14) {
          cachedMap[c.i] = hit.value;
        } else {
          pending.push(c);
        }
      }
      const findings = [];
      for (const c of candidates) {
        const value = cachedMap[c.i];
        if (!value) continue;
        const finding = Ai.normalizeResult(value, c, host);
        if (finding) {
          finding.cached = true;
          findings.push(finding);
        }
      }
      if (!pending.length) return { ok: true, findings, cached: findings.length, calls: 0 };

      const context = {
        host,
        url: String(opts.url || "").slice(0, 300),
        title: String(opts.title || "").slice(0, 160),
      };
      const messages = [
        { role: "system", content: ZZ.AiPrompt.systemPrompt(settings) },
        { role: "user", content: ZZ.AiPrompt.candidatePayload(pending, context, settings) },
      ];
      const res = await chat(messages, settings, { maxTokens: 1800 });
      if (!res.ok) return { ok: false, error: res.error || "AI 请求失败", status: res.status };
      const parsed = extractJson(res.content);
      if (!parsed || !Array.isArray(parsed.results)) {
        return { ok: false, error: "AI 返回内容无法解析为 JSON", raw: String(res.content || "").slice(0, 300) };
      }
      const byIndex = {};
      for (const item of parsed.results) {
        if (!item || typeof item !== "object") continue;
        const idx = Number(item.i);
        if (isFinite(idx)) byIndex[idx] = item;
      }
      let fresh = 0;
      for (const c of pending) {
        const raw = byIndex[c.i];
        if (!raw) continue;
        const key = candidateSig(host, c);
        await ZZ.Store.cacheAiResult(key, {
          ad: raw.ad === true,
          confidence: raw.confidence,
          category: raw.category,
          selector: raw.selector,
          generic: raw.generic,
          blockDomain: raw.blockDomain,
          reason: raw.reason,
        });
        const finding = Ai.normalizeResult(raw, c, host);
        if (finding) {
          findings.push(finding);
          fresh++;
        }
      }
      return {
        ok: true,
        findings,
        cached: findings.length - fresh,
        calls: 1,
        usage: res.usage || null,
        ms: res.ms,
      };
    },

    async test() {
      const settings = ZZ.Store.settings();
      const messages = [
        { role: "system", content: 'You are a health check. Reply with strict JSON: {"ok":true}' },
        { role: "user", content: "ping" },
      ];
      const res = await chat(messages, settings, { maxTokens: 20 });
      if (!res.ok) return { ok: false, error: res.error, status: res.status };
      const parsed = extractJson(res.content);
      return { ok: !!parsed, ms: res.ms, model: settings.ai.model, sample: String(res.content || "").slice(0, 80) };
    },
  };

  ZZ.Ai = Ai;
})();
