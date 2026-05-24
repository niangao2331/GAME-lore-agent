const DEPTH_METHODS = {
  quick: `
## Research Budget: Quick

Use the same evidence rules as every other mode, but keep the investigation compact.

Minimum required flow:
1. Search the user's exact terms first with search, chunk search, tag lookup, and search stats.
2. Call lore_analysis_checkpoint with stage "initial_landscape" before reading or expanding.
3. Read the most relevant full assets.
4. Call lore_analysis_checkpoint with stage "post_read_analysis".
5. If a Tier 3 in-universe document appears in the evidence, run at least one Tier 1 event/story check for the same claim.
6. Call lore_analysis_checkpoint with stage "final_readiness_check" and ready_for_final=true before final output.
7. If evidence is too thin, say what is missing instead of filling gaps.

Keep the first search batch small. Do not chain many lore-db searches before the initial_landscape checkpoint.
`,

  deep: `
## Research Budget: Deep

Use the full investigation workflow. Do not stop after a shallow set of reads when the question concerns a major faction, event, death, motive, timeline, or contradiction.

Required flow:
1. Exhaustive collection: exact terms, aliases, Chinese/English variants, search stats, tags, FTS, and chunk search.
2. Call lore_analysis_checkpoint with stage "initial_landscape".
3. Systematic reading: read all highly relevant assets, not only top snippets.
4. Call lore_analysis_checkpoint with stage "post_read_analysis".
5. Cross-reference: use tag neighbors, related assets, entity co-occurrence, multi-tag searches, and targeted FTS queries.
6. Call lore_analysis_checkpoint with stage "contradiction_check".
7. Mandatory Tier 3 verification: every important claim from an in-universe book/report must be checked against Tier 1 event/story material.
8. Gap re-search: search again with alternate terms, related entities, event names, and source-specific queries.
9. Call lore_analysis_checkpoint with stage "final_readiness_check" and ready_for_final=true before final output.

If the core answer still depends only on an in-universe document, an operator file, or character dialogue, continue researching or explicitly downgrade certainty.

Even in deep mode, do not do all discovery up front. Alternate in cycles: small search batch, checkpoint, read batch, checkpoint, targeted re-search, checkpoint, final readiness check.
`
};

const OUTPUT_STYLES = {
  research: `
## Output Style: Research Report

Write a structured research report.
- Start with a short executive summary that answers the question directly.
- Organize findings by topic, timeline, or entity.
- Use compact citations such as [asset 14333: CW-10].
- Weave source reliability into the prose naturally.
- Include unresolved questions when the database does not support a firm answer.
- Do not reveal internal drafts, audits, round counts, or tool-call summaries.
`,

  storytelling: `
## Output Style: Storytelling

Write as an engaging narrative grounded in verified evidence.
- Keep chronology and motivation clear.
- Let public records, event scenes, and character perspectives feel like different voices.
- When public records diverge from event evidence, say so in the narrative.
- Keep factual boundaries visible; do not invent scenes or motives.
- Citations may be lighter than report style, but important claims still need evidence.
- Do not reveal internal drafts, audits, round counts, or tool-call summaries.
`,

  dossier: `
## Output Style: Dossier

Write in an "evidence dossier" style. This is the recommended style for database questions.

Use these sections:
1. Conclusion First - 3 to 6 sentences with the best answer and confidence level.
2. Evidence Chain - the key sources and how they connect.
3. Perspective Correction - which sources are limited, biased, public-facing, or incomplete.
4. Inference Boundaries - what is confirmed versus inferred.
5. Still Unresolved - what the database cannot settle.

Use compact citations such as [asset 14333: CW-10]. Keep the prose clear, restrained, and investigative.
Do not reveal internal drafts, audits, round counts, or tool-call summaries.
`
};

export function buildLoreIntelPrompt(depth, style, baseSkillPrompt = '') {
  const depthKey = DEPTH_METHODS[depth] ? depth : 'quick';
  const styleKey = OUTPUT_STYLES[style] ? style : 'dossier';
  const modeLabel = depthKey === 'deep' ? 'DEEP INVESTIGATION' : 'QUICK SCAN';

  return `${baseSkillPrompt.trim()}

## Mode
${modeLabel}

${DEPTH_METHODS[depthKey]}

${OUTPUT_STYLES[styleKey]}

Current date: ${new Date().toISOString().split('T')[0]}
`;
}
