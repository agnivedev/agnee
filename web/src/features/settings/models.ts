/**
 * Price per one million tokens (in / out). WhatsApp replies are short, so the
 * bill is dominated by the input price — a model with an expensive output price
 * is not necessarily expensive in real use.
 *
 * Every id below was verified live on OpenRouter (2026-09-10). A dead id fails
 * at send time, not at save time, so do not add one from memory.
 */
export const AVAILABLE_MODELS: { value: string; label?: string; labelKey?: string }[] = [
  { value: '', labelKey: 'admin.notUsed' },
  { value: 'mistralai/mistral-nemo', label: 'Mistral Nemo  ·  masuk $0,02 / keluar $0,03' },
  { value: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B  ·  masuk $0,05 / keluar $0,08' },
  { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite  ·  masuk $0,10 / keluar $0,40' },
  { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B  ·  masuk $0,10 / keluar $0,32' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini  ·  masuk $0,15 / keluar $0,60' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash  ·  masuk $0,30 / keluar $2,50 (default)' },
  { value: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B  ·  masuk $0,36 / keluar $0,40' },
  { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5  ·  masuk $1,00 / keluar $5,00' },
  { value: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5  ·  masuk $2,00 / keluar $10,00' },
];

export const MODEL_SLOT_COUNT = 5;

/** Matches exactly, or by the part after the slash ("qwen-2.5-72b" vs "qwen/qwen-2.5-72b"). */
export function findModel(value: string) {
  return AVAILABLE_MODELS.find((model) => model.value === value || (value && model.value.endsWith(`/${value}`)));
}
