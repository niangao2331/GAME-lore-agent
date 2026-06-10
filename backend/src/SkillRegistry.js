import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildLoreIntelPrompt } from './prompts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = join(__dirname, '..', 'skills');

function readSkillBody(name) {
  const skillPath = join(SKILL_ROOT, name, 'SKILL.md');
  if (!existsSync(skillPath)) return '';

  const raw = readFileSync(skillPath, 'utf-8');
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return (match ? match[1] : raw).trim();
}

export class SkillRegistry {
  constructor() {
    this.skills = new Map();
    this._registerDefaults();
  }

  _registerDefaults() {
    // Load database-specific skill prompts
    const arknightsPrompt = readSkillBody('lore-arknights');
    const genericPrompt = readSkillBody('lore-generic');

    // Arknights-specific skills (game-tuned prompts)
    const arknightsVariants = [
      {
        name: 'lore-arknights',
        displayName: '综合解析 [快速]',
        description: '快速综合解析，适用于明日方舟资料库。',
        depth: 'quick',
        style: 'dossier',
        database: 'arknights',
        icon: 'AQ'
      },
      {
        name: 'lore-arknights-deep',
        displayName: '综合解析 [深度]',
        description: '深度综合解析，适用于明日方舟资料库。',
        depth: 'deep',
        style: 'dossier',
        database: 'arknights',
        icon: 'AD'
      },
      {
        name: 'lore-arknights-structured',
        displayName: '综合解析 [结构化]',
        description: '结构化综合解析，适用于明日方舟资料库。',
        depth: 'structured',
        style: 'dossier',
        database: 'arknights',
        icon: 'AS'
      }
    ];

    // Generic skills (de-gamed prompts for other databases)
    const genericVariants = [
      {
        name: 'lore-generic',
        displayName: '综合解析 [快速]',
        description: '快速综合解析，适用于通用资料库。',
        depth: 'quick',
        style: 'dossier',
        database: 'generic',
        icon: 'GQ'
      },
      {
        name: 'lore-generic-deep',
        displayName: '综合解析 [深度]',
        description: '深度综合解析，适用于通用资料库。',
        depth: 'deep',
        style: 'dossier',
        database: 'generic',
        icon: 'GD'
      },
      {
        name: 'lore-generic-structured',
        displayName: '综合解析 [结构化]',
        description: '结构化综合解析，适用于通用资料库。',
        depth: 'structured',
        style: 'dossier',
        database: 'generic',
        icon: 'GS'
      }
    ];

    for (const variant of arknightsVariants) {
      this.register({
        ...variant,
        systemPrompt: buildLoreIntelPrompt(variant.database, variant.depth, variant.style, arknightsPrompt)
      });
    }

    for (const variant of genericVariants) {
      this.register({
        ...variant,
        systemPrompt: buildLoreIntelPrompt(variant.database, variant.depth, variant.style, genericPrompt)
      });
    }
  }

  register(skill) {
    this.skills.set(skill.name, skill);
  }

  get(name) {
    return this.skills.get(name) || this.skills.get('lore-arknights');
  }

  has(name) {
    return this.skills.has(name);
  }

  getAll() {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      displayName: s.displayName,
      description: s.description,
      icon: s.icon
    }));
  }

  get size() {
    return this.skills.size;
  }
}
