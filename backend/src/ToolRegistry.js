import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this._registerBuiltins();
  }

  _registerBuiltins() {
    this.register({
      name: 'read_file',
      description: 'Read the contents of a file at the given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to read' }
        },
        required: ['path']
      },
      handler: async ({ path: filePath }) => {
        if (!existsSync(filePath)) return `File not found: ${filePath}`;
        return readFileSync(filePath, 'utf-8');
      }
    });

    this.register({
      name: 'write_file',
      description: 'Write content to a file at the given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to write to' },
          content: { type: 'string', description: 'The content to write' }
        },
        required: ['path', 'content']
      },
      handler: async ({ path: filePath, content }) => {
        writeFileSync(filePath, content, 'utf-8');
        return `File written: ${filePath}`;
      }
    });

    this.register({
      name: 'execute_command',
      description: 'Execute a shell command and return the output.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' }
        },
        required: ['command']
      },
      handler: async ({ command }) => {
        try {
          const output = execSync(command, {
            encoding: 'utf-8',
            timeout: 30000,
            maxBuffer: 10 * 1024 * 1024
          });
          return output || '(command completed with no output)';
        } catch (e) {
          return `Command failed: ${e.message}\n${e.stderr || ''}`;
        }
      }
    });

    this.register({
      name: 'web_search',
      description: 'Search the web for information. Returns relevant search results.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
      },
      handler: async ({ query }) => {
        try {
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await fetch(url);
          const html = await res.text();
          // Simple extraction of result snippets
          const snippets = [];
          const re = /class="result__snippet"[^>]*>(.*?)<\/a>/gs;
          let match;
          while ((match = re.exec(html)) !== null && snippets.length < 5) {
            snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
          }
          return snippets.length > 0
            ? snippets.map((s, i) => `${i + 1}. ${s}`).join('\n')
            : 'No search results found. Try a different query.';
        } catch (e) {
          return `Search failed: ${e.message}`;
        }
      }
    });

    this.register({
      name: 'web_fetch',
      description: 'Fetch and read the content of a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' }
        },
        required: ['url']
      },
      handler: async ({ url }) => {
        try {
          const res = await fetch(url);
          const text = await res.text();
          // Strip HTML tags for rough text extraction
          const stripped = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          return stripped.slice(0, 8000);
        } catch (e) {
          return `Fetch failed: ${e.message}`;
        }
      }
    });

    this.register({
      name: 'calculator',
      description: 'Evaluate a mathematical expression. Supports +, -, *, /, **, %, (), and common math functions.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Mathematical expression to evaluate, e.g. "2 + 3 * 4"' }
        },
        required: ['expression']
      },
      handler: async ({ expression }) => {
        try {
          const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
          const result = Function(`"use strict"; return (${sanitized})`)();
          return `Result: ${result}`;
        } catch (e) {
          return `Calculation error: ${e.message}`;
        }
      }
    });

    this.register({
      name: 'lore_analysis_checkpoint',
      description: 'MANDATORY for lore research: call this between search/read batches to record analysis, evidence gaps, contradictions, and the next search plan. Also call it immediately before any final lore answer.',
      parameters: {
        type: 'object',
        properties: {
          stage: {
            type: 'string',
            description: 'Workflow stage, e.g. initial_landscape, post_read_analysis, contradiction_check, gap_research_plan, final_readiness_check'
          },
          working_conclusion: {
            type: 'string',
            description: 'Current best answer or hypothesis, explicitly marked as provisional if not ready'
          },
          evidence_status: {
            type: 'string',
            description: 'What the evidence currently supports, including source tiers and key asset ids/titles when known'
          },
          gaps_or_contradictions: {
            type: 'string',
            description: 'What remains unsupported, contradictory, narrator-limited, or uncertain'
          },
          next_search_plan: {
            type: 'string',
            description: 'Concrete next searches/reads to perform, or "none" only when ready for final answer'
          },
          ready_for_final: {
            type: 'boolean',
            description: 'True only when source-tier checks and gap checks are complete'
          },
          plan_session_id: {
            type: 'string',
            description: 'Optional research/session id if a planner tool exists in this runtime'
          },
          completed_subtasks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Subtask titles or ids completed since the last checkpoint'
          },
          read_unit_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Asset ids or chunk ids read with lore_db_read/lore_db_read_context for central evidence'
          },
          coverage_checklist_status: {
            type: 'string',
            description: 'Explicit status of the plan coverage checklist, especially missing Tier 1/Tier 2/Tier 3 lanes'
          },
          missing_required_sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'Required source lanes or documents still missing'
          }
        },
        required: [
          'stage',
          'working_conclusion',
          'evidence_status',
          'gaps_or_contradictions',
          'next_search_plan',
          'ready_for_final'
        ]
      },
      handler: async (args) => {
        const completedSubtasks = Array.isArray(args.completed_subtasks) ? args.completed_subtasks : [];
        const readUnitIds = Array.isArray(args.read_unit_ids) ? args.read_unit_ids : [];
        const missingRequired = Array.isArray(args.missing_required_sources) ? args.missing_required_sources : [];
        const warnings = [];
        if (!completedSubtasks.length && args.stage !== 'final_readiness_check') {
          warnings.push('No completed search/read steps were reported; this checkpoint may be only a narrative self-report.');
        }
        if ((args.stage === 'post_read_analysis' || args.stage === 'final_readiness_check') && !readUnitIds.length) {
          warnings.push('No read asset/chunk ids were reported; central claims may still be based on snippets.');
        }
        if (args.ready_for_final && (missingRequired.length || !readUnitIds.length)) {
          warnings.push('ready_for_final=true is not credible while required sources are missing or no full assets/passages were read.');
        }

        const status = args.ready_for_final
          ? 'Final readiness checkpoint recorded. You may answer only if the stated gaps are acceptable, full units were read, and uncertainty is explicit.'
          : 'Analysis checkpoint recorded. Continue the planned searches/reads before finalizing.';

        return [
          status,
          `Stage: ${args.stage}`,
          warnings.length ? `Checkpoint warnings: ${warnings.join(' ')}` : 'Checkpoint validation: structured fields present.',
          `Plan session: ${args.plan_session_id || '(not used in this runtime)'}`,
          `Completed search/read steps: ${completedSubtasks.length ? completedSubtasks.join(', ') : '(none reported)'}`,
          `Read asset/chunk ids: ${readUnitIds.length ? readUnitIds.join(', ') : '(none reported)'}`,
          `Coverage checklist status: ${args.coverage_checklist_status || '(not reported)'}`,
          `Missing required sources: ${missingRequired.length ? missingRequired.join(', ') : '(none reported)'}`,
          `Working conclusion: ${args.working_conclusion}`,
          `Evidence status: ${args.evidence_status}`,
          `Gaps or contradictions: ${args.gaps_or_contradictions}`,
          `Next search plan: ${args.next_search_plan}`
        ].join('\n');
      }
    });
  }

  register(tool) {
    this.tools.set(tool.name, tool);
  }

  unregister(name) {
    this.tools.delete(name);
  }

  get(name) {
    return this.tools.get(name);
  }

  getAll() {
    return Array.from(this.tools.values()).map(({ name, description, parameters }) => ({
      name, description, parameters
    }));
  }

  async execute(name, args) {
    const tool = this.tools.get(name);
    if (!tool) return `Tool "${name}" not found`;
    return tool.handler(args);
  }

  get size() {
    return this.tools.size;
  }
}
