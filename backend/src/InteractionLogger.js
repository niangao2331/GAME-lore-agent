import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DEFAULT_MAX_FIELD_CHARS = 200000;

function clampMaxChars(value) {
  const n = Number(value || DEFAULT_MAX_FIELD_CHARS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_FIELD_CHARS;
  return Math.min(Math.max(Math.round(n), 1000), 5_000_000);
}

function truncateString(value, maxChars) {
  if (typeof value !== 'string' || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function sanitize(value, maxChars) {
  if (typeof value === 'string') return truncateString(value, maxChars);
  if (Array.isArray(value)) return value.map(item => sanitize(item, maxChars));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (/api[_-]?key|authorization|token|password|secret/i.test(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = sanitize(child, maxChars);
      }
    }
    return out;
  }
  return value;
}

export class InteractionLogger {
  constructor(dataDir) {
    this.logDir = join(dataDir, 'interaction-logs');
    this.filePath = join(this.logDir, 'agent-mcp.jsonl');
    this.maxFieldChars = clampMaxChars(process.env.INTERACTION_LOG_MAX_CHARS);
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
  }

  write(event) {
    const entry = sanitize({
      timestamp: new Date().toISOString(),
      ...event,
    }, this.maxFieldChars);

    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
  }
}
