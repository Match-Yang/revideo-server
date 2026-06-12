import { loadSettings } from "../settings";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TranslateTextResult {
  content: string;
  usage?: TokenUsage;
}

export interface TranslateProviderConfig {
  provider: "openai-compatible";
  baseUrl: string;
  model: string;
  apiKey?: string;
  thinkingType?: "enabled" | "disabled" | "auto";
  timeoutMs: number;
}

export interface TranslateRequest {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  systemPrompt?: string;
  jsonSchema?: Record<string, unknown>;
}

export function getTranslateConfig(): TranslateProviderConfig {
  const settings = loadSettings();
  const llm = settings.llm;

  return {
    provider: "openai-compatible",
    baseUrl: llm.baseUrl || "https://api.openai.com/v1",
    model: llm.textModel || "gpt-4.1-mini",
    apiKey: llm.apiKey,
    thinkingType: "disabled",
    timeoutMs: Math.max(1000, Number(llm.timeoutSec || 120) * 1000),
  };
}

export function listTranslateProviders() {
  const config = getTranslateConfig();
  return [
    {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      thinkingType: config.thinkingType,
      configured: Boolean(config.apiKey),
    },
  ];
}

export interface TranslateJSONRequest {
  text: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  systemPrompt: string;
  jsonSchema?: Record<string, unknown>;
}

export async function translateJSON<T>(req: TranslateJSONRequest): Promise<T> {
  const config = getTranslateConfig();
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error("Missing LLM API key in settings");
  }
  const timeoutMs = config.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: req.systemPrompt },
      { role: "user", content: req.text },
    ],
    temperature: 0.2,
  };

  if (req.jsonSchema) {
    requestBody.response_format = {
      type: "json_schema",
      json_schema: req.jsonSchema,
    };
  }

  if (config.thinkingType) {
    requestBody.thinking = { type: config.thinkingType };
  }

  let resp: Response;
  try {
    resp = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Translate JSON request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`Translate JSON request failed: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Translate JSON response did not include choices[0].message.content");
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Translate JSON response is not valid JSON: ${content}`);
  }

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    throw new Error(`Failed to parse translate JSON response: ${content}`);
  }
}

export async function translateText(req: TranslateRequest): Promise<string> {
  const config = getTranslateConfig();
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error("Missing LLM API key in settings");
  }
  const timeoutMs = config.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages: [
      {
        role: "system",
        content:
          req.systemPrompt ||
          `Translate the user's text into ${req.targetLanguage}. Preserve meaning and formatting.`,
      },
      {
        role: "user",
        content: req.text,
      },
    ],
    temperature: 0.2,
  };

  if (req.jsonSchema) {
    requestBody.response_format = {
      type: "json_schema",
      json_schema: req.jsonSchema,
    };
  }

  if (config.thinkingType) {
    requestBody.thinking = { type: config.thinkingType };
  }

  let resp: Response;
  try {
    resp = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Translate request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`Translate request failed: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const translated = data.choices?.[0]?.message?.content;
  if (!translated) {
    throw new Error("Translate response did not include choices[0].message.content");
  }
  return translated;
}

export async function translateTextWithUsage(req: TranslateRequest): Promise<TranslateTextResult> {
  const config = getTranslateConfig();
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error("Missing LLM API key in settings");
  }
  const timeoutMs = config.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages: [
      {
        role: "system",
        content:
          req.systemPrompt ||
          `Translate the user's text into ${req.targetLanguage}. Preserve meaning and formatting.`,
      },
      {
        role: "user",
        content: req.text,
      },
    ],
    temperature: 0.2,
  };

  if (req.jsonSchema) {
    requestBody.response_format = {
      type: "json_schema",
      json_schema: req.jsonSchema,
    };
  }

  if (config.thinkingType) {
    requestBody.thinking = { type: config.thinkingType };
  }

  let resp: Response;
  try {
    resp = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Translate request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`Translate request failed: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Translate response did not include choices[0].message.content");
  }

  const usage: TokenUsage | undefined = data.usage
    ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      }
    : undefined;

  return { content, usage };
}
