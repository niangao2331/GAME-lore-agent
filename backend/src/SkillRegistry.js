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
    const loreIntelPrompt = readSkillBody('lore-intel');

    const variants = [
      {
        name: 'lore-intel',
        displayName: 'Intelligence Analyst',
        description: 'Quick lore intelligence workflow. Dossier output.',
        depth: 'quick',
        style: 'dossier',
        icon: 'IA'
      },
      {
        name: 'lore-intel-research',
        displayName: 'Intelligence Analyst [Report]',
        description: 'Quick lore intelligence workflow. Research report output.',
        depth: 'quick',
        style: 'research',
        icon: 'IR'
      },
      {
        name: 'lore-intel-story',
        displayName: 'Intelligence Analyst [Story]',
        description: 'Quick lore intelligence workflow. Narrative output.',
        depth: 'quick',
        style: 'storytelling',
        icon: 'IS'
      },
      {
        name: 'lore-intel-deep',
        displayName: 'Intelligence Analyst [Deep]',
        description: 'Deep lore intelligence workflow. Dossier output.',
        depth: 'deep',
        style: 'dossier',
        icon: 'ID'
      },
      {
        name: 'lore-intel-deep-research',
        displayName: 'Intelligence Analyst [Deep Report]',
        description: 'Deep lore intelligence workflow. Research report output.',
        depth: 'deep',
        style: 'research',
        icon: 'DR'
      },
      {
        name: 'lore-intel-deep-story',
        displayName: 'Intelligence Analyst [Deep Story]',
        description: 'Deep lore intelligence workflow. Narrative output.',
        depth: 'deep',
        style: 'storytelling',
        icon: 'DS'
      }
    ];

    for (const variant of variants) {
      this.register({
        ...variant,
        systemPrompt: buildLoreIntelPrompt(variant.depth, variant.style, loreIntelPrompt)
      });
    }
  }

  register(skill) {
    this.skills.set(skill.name, skill);
  }

  get(name) {
    return this.skills.get(name) || this.skills.get('lore-intel');
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
