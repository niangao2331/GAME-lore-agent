export const DEPTH_CONFIG = {
  quick: {
    maxRounds: 20,
    searchLimit: 50,
    chunkLimit: 20,
  },
  deep: {
    maxRounds: 40,
    searchLimit: 150,
    chunkLimit: 50,
  },
};

export const STYLE_CONFIG = {
  dossier: {
    label: 'Dossier',
  },
  research: {
    label: 'Research Report',
  },
  storytelling: {
    label: 'Storytelling',
  },
};

export function getSkillName(depth, style) {
  const d = DEPTH_CONFIG[depth] ? depth : 'quick';
  const s = STYLE_CONFIG[style] ? style : 'dossier';

  if (d === 'deep' && s === 'research') return 'lore-intel-deep-research';
  if (d === 'deep' && s === 'storytelling') return 'lore-intel-deep-story';
  if (d === 'deep') return 'lore-intel-deep';
  if (s === 'research') return 'lore-intel-research';
  if (s === 'storytelling') return 'lore-intel-story';
  return 'lore-intel';
}
