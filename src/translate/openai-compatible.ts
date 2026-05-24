export interface TranslateProviderConfig {
  provider: "openai-compatible";
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  thinkingType?: "enabled" | "disabled" | "auto";
}

export interface TranslateRequest {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  systemPrompt?: string;
}

export function getTranslateConfig(): TranslateProviderConfig {
  const apiKeyEnv =
    process.env.TRANSLATE_API_KEY_ENV ||
    (process.env.VOLCENGINE_API_KEY ? "VOLCENGINE_API_KEY" : undefined) ||
    (process.env.ARK_API_KEY ? "ARK_API_KEY" : undefined) ||
    "OPENAI_API_KEY";

  return {
    provider: "openai-compatible",
    baseUrl: process.env.TRANSLATE_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.TRANSLATE_MODEL || "gpt-4.1-mini",
    apiKeyEnv,
    thinkingType: (process.env.TRANSLATE_THINKING_TYPE as TranslateProviderConfig["thinkingType"]) || "disabled",
  };
}

export function listTranslateProviders() {
  const config = getTranslateConfig();
  return [
    {
      ...config,
      configured: Boolean(process.env[config.apiKeyEnv]),
    },
  ];
}

export interface TranslateJSONRequest {
  text: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  systemPrompt: string;
}

export async function translateJSON<T>(req: TranslateJSONRequest): Promise<T> {
  const config = getTranslateConfig();
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing API key env: ${config.apiKeyEnv}`);
  }
  const timeoutMs = Math.max(1000, Number(process.env.TRANSLATE_TIMEOUT_MS || 120000));
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
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing API key env: ${config.apiKeyEnv}`);
  }
  const timeoutMs = Math.max(1000, Number(process.env.TRANSLATE_TIMEOUT_MS || 120000));
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
  };
  const translated = data.choices?.[0]?.message?.content;
  if (!translated) {
    throw new Error("Translate response did not include choices[0].message.content");
  }
  return translated;
}
