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
  structured: {
    maxRounds: 35,
    searchLimit: 120,
    chunkLimit: 40,
  },
};

// RAG feature flags — independent from depth mode.
// Each flag can be toggled separately for gradual rollout.
// In production, these are overridden by rag_feature_flags DB table.
export const RAG_CONFIG = {
  enabled: false,                // Master switch
  doc_recall: false,             // Document-level dense recall in Plan phase
  unit_recall: false,            // Unit-level dense recall in Subtask phase
  rerank: false,                 // Cross-encoder rerank for A+B candidates
  query_rewrite: false,          // Query rewrite for fuzzy/natural-language
  generation: false,             // Optional LLM answer generation
  fallback_on_error: true,       // Auto fallback to A-only on RAG error
  fallback_on_staleness: true,   // Auto fallback when vectors are stale
  doc_recall_top_k: 20,          // Default top-K for doc dense recall
  unit_recall_top_k: 12,         // Default top-K for unit dense recall
  rerank_top_k: 20,              // Default top-K for rerank
  rrf_a_weight: 1.0,             // RRF weight for A-side candidates
  rrf_b_weight: 0.8,             // RRF weight for B-side (RAG) candidates
};

export const STYLE_CONFIG = {
  dossier: {
    label: 'Synthesis',
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

  if (d === 'structured') return 'lore-intel-structured';
  if (d === 'deep' && s === 'research') return 'lore-intel-deep-research';
  if (d === 'deep' && s === 'storytelling') return 'lore-intel-deep-story';
  if (d === 'deep') return 'lore-intel-deep';
  if (s === 'research') return 'lore-intel-research';
  if (s === 'storytelling') return 'lore-intel-story';
  return 'lore-intel';
}
