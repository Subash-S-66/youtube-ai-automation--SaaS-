import SystemConfig from '../models/SystemConfig';

type GeminiModelCatalogSource = 'api' | 'fallback';

export interface GeminiModelCatalog {
  models: string[];
  source: GeminiModelCatalogSource;
  fetchedAt: string;
}

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const DEFAULT_GEMINI_FALLBACK_MODELS = [
  DEFAULT_GEMINI_MODEL,
  'gemini-2.0-flash-lite-001',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash',
];
const NON_TEXT_MODEL_PATTERN = /(embedding|audio|image|live|computer-use|robotics)/i;
const CONFIG_CACHE_TTL_MS = 30 * 1000;
const MODEL_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const MODEL_LIST_REQUEST_TIMEOUT_MS = 10 * 1000;

let configuredModelCache: { value: string; expiresAt: number } | null = null;
let modelCatalogCache: { value: GeminiModelCatalog; expiresAt: number } | null = null;

const normalizeGeminiModel = (value: unknown, fallback = DEFAULT_GEMINI_MODEL): string => {
  const normalized = String(value || '').trim().replace(/^models\//i, '');
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 120);
};

const uniqueModels = (values: unknown[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeGeminiModel(value, '');
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
};

const getEnvDefaultModel = (): string => {
  return normalizeGeminiModel(process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL);
};

const getEnvFallbackModels = (): string[] => {
  const csv = `${process.env.GEMINI_FALLBACK_MODELS || ''},${process.env.GEMINI_FALLBACK_MODEL || ''}`;
  const parsed = csv
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return uniqueModels(parsed);
};

const getModelPriority = (model: string): number => {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) {
    return 100;
  }
  if (normalized === DEFAULT_GEMINI_MODEL) {
    return 0;
  }
  if (normalized.includes('flash-lite')) {
    return 10;
  }
  if (normalized.includes('flash')) {
    return 20;
  }
  if (normalized.includes('pro')) {
    return 90;
  }
  return 50;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const fetchAvailableGeminiModelsFromApi = async (): Promise<string[]> => {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout(fetch(endpoint), MODEL_LIST_REQUEST_TIMEOUT_MS, 'Gemini model list request');
  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    throw new Error(`Gemini model list API failed: ${response.status} ${response.statusText} ${rawBody}`.trim());
  }

  const payload = (await response.json().catch(() => ({}))) as {
    models?: Array<{
      name?: string;
      supportedGenerationMethods?: string[];
    }>;
  };
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const generationModels = models
    .filter((model) => {
      const methods = Array.isArray(model?.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
      return methods.includes('generateContent');
    })
    .map((model) => normalizeGeminiModel(model?.name, ''))
    .filter((model) => model.startsWith('gemini-'));

  const unique = uniqueModels(generationModels);
  if (unique.length === 0) {
    throw new Error('Gemini model list API returned no generateContent-compatible models.');
  }
  return unique;
};

const buildFallbackCatalog = async (): Promise<GeminiModelCatalog> => {
  const configured = await getConfiguredGeminiModel();
  return {
    models: uniqueModels([
      configured,
      getEnvDefaultModel(),
      ...getEnvFallbackModels(),
      ...DEFAULT_GEMINI_FALLBACK_MODELS,
    ]),
    source: 'fallback',
    fetchedAt: new Date().toISOString(),
  };
};

export const getConfiguredGeminiModel = async (forceRefresh = false): Promise<string> => {
  const now = Date.now();
  if (!forceRefresh && configuredModelCache && configuredModelCache.expiresAt > now) {
    return configuredModelCache.value;
  }

  let configured = getEnvDefaultModel();
  try {
    const config = await SystemConfig.findOne()
      .sort({ updatedAt: -1 })
      .select('geminiModel')
      .lean();
    configured = normalizeGeminiModel((config as any)?.geminiModel, configured);
  } catch (error) {
    console.warn('[GeminiModelService] Failed to load geminiModel from SystemConfig. Falling back to env.', error);
  }

  configuredModelCache = {
    value: configured,
    expiresAt: now + CONFIG_CACHE_TTL_MS,
  };
  return configured;
};

export const getGeminiModelCatalog = async (forceRefresh = false): Promise<GeminiModelCatalog> => {
  const now = Date.now();
  if (!forceRefresh && modelCatalogCache && modelCatalogCache.expiresAt > now) {
    return modelCatalogCache.value;
  }

  let catalog: GeminiModelCatalog;
  try {
    const fromApi = await fetchAvailableGeminiModelsFromApi();
    const configured = await getConfiguredGeminiModel();
    catalog = {
      models: uniqueModels([configured, ...fromApi]),
      source: 'api',
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn('[GeminiModelService] Failed to fetch Gemini model list from API. Using fallback list.', error);
    catalog = await buildFallbackCatalog();
  }

  modelCatalogCache = {
    value: catalog,
    expiresAt: now + MODEL_CATALOG_CACHE_TTL_MS,
  };
  return catalog;
};

export const getGeminiModelAttemptSequence = async (maxAlternativeRetries = 3): Promise<string[]> => {
  const primary = await getConfiguredGeminiModel();
  const catalog = await getGeminiModelCatalog();
  const allCandidates = uniqueModels([
    ...(catalog.models || []),
    ...getEnvFallbackModels(),
    ...DEFAULT_GEMINI_FALLBACK_MODELS,
  ]);
  const textCandidates = allCandidates.filter((model) => !NON_TEXT_MODEL_PATTERN.test(model));
  const candidatePool = textCandidates.length > 0 ? textCandidates : allCandidates;
  const alternatives = candidatePool
    .filter((model) => model !== primary)
    .sort((a, b) => {
      const priorityDiff = getModelPriority(a) - getModelPriority(b);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.localeCompare(b);
    });
  const selectedAlternatives = alternatives.slice(0, Math.max(0, Math.floor(maxAlternativeRetries)));
  return [primary, ...selectedAlternatives];
};

