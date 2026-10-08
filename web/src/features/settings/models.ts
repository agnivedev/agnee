/**
 * Labels are tiers on purpose: a customer sees "High-end AI model", never the
 * vendor, the model name, or what we pay per token. Do not put either back in
 * a label, and do not put a real model id in a `value`: these values travel to
 * and from the server and show up in DevTools. The server maps each key to the
 * real OpenRouter id (src/model-tiers.js, same keys and same order). A chain
 * saved with an id outside this list comes back as 'custom'.
 */
export const CUSTOM_MODEL_KEY = 'custom';

export const AVAILABLE_MODELS: { value: string; label?: string; labelKey?: string }[] = [
  { value: '', labelKey: 'admin.notUsed' },
  { value: 'low-a', label: 'Low-end AI model A' },
  { value: 'low-b', label: 'Low-end AI model B' },
  { value: 'low-c', label: 'Low-end AI model C' },
  { value: 'mid-a', label: 'Medium-end AI model A' },
  { value: 'mid-b', label: 'Medium-end AI model B' },
  { value: 'mid-c', label: 'Medium-end AI model C' },
  { value: 'mid-d', label: 'Medium-end AI model D (default)' },
  { value: 'high', label: 'High-end AI model' },
  { value: 'top', label: 'Top-end AI model' },
];

export const MODEL_SLOT_COUNT = 5;

export function findModel(value: string) {
  return AVAILABLE_MODELS.find((model) => model.value === value);
}
