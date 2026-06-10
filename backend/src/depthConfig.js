export const DEPTH_CONFIG = {
  quick: {
    maxRounds: 20,
  },
  deep: {
    maxRounds: 40,
  },
  structured: {
    maxRounds: 35,
  },
};

export const STYLE_CONFIG = {
  dossier: {
    label: 'Synthesis',
  },
  research: {
    label: 'Source-Aware',
  },
  storytelling: {
    label: 'Narrative',
  },
};

export function getSkillName(database, depth, style) {
  const d = DEPTH_CONFIG[depth] ? depth : 'quick';
  const s = STYLE_CONFIG[style] ? style : 'dossier';
  const prefix = database === 'arknights' ? 'lore-arknights' : 'lore-generic';

  if (d === 'structured') return `${prefix}-structured`;
  if (d === 'deep') return `${prefix}-deep`;
  return prefix;
}
