import { v4 as uuidv4 } from 'uuid';
import { getSkillName, DEPTH_CONFIG } from '../depthConfig.js';

function parseToolArgs(rawArgs) {
  try {
    return JSON.parse(rawArgs || '{}');
  } catch {
    return rawArgs;
  }
}

function isMcpTool(name) {
  return typeof name === 'string' && name.startsWith('mcp_');
}

function parseMcpJsonPayload(result) {
  if (typeof result !== 'string') return null;
  const marker = '\n\n[WORKFLOW REMINDER]';
  const jsonText = result.includes(marker) ? result.slice(0, result.indexOf(marker)) : result;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function compactReadResultForLog(parsed, originalChars) {
  if (!parsed || typeof parsed !== 'object') return { originalChars, compacted: true };
  return {
    compacted: true,
    originalChars,
    document_id: parsed.document_id,
    asset_id: parsed.asset_id,
    title: parsed.title,
    subtitle: parsed.subtitle,
    source_name: parsed.source_name,
    source_uri: parsed.source_uri,
    source_tier: parsed.source_tier,
    content_type: parsed.content_type,
    canon_status: parsed.canon_status,
    top_group: parsed.top_group,
    group_name: parsed.group_name,
    char_count: parsed.char_count,
    full_text_chars: typeof parsed.full_text === 'string' ? parsed.full_text.length : 0,
    units_count: Array.isArray(parsed.units) ? parsed.units.length : 0,
    entities_count: Array.isArray(parsed.entities) ? parsed.entities.length : 0,
  };
}

function compactReadContextResultForLog(parsed, originalChars) {
  if (!parsed || typeof parsed !== 'object') return { originalChars, compacted: true };
  return {
    compacted: true,
    originalChars,
    asset: parsed.asset ? {
      document_id: parsed.asset.document_id,
      asset_id: parsed.asset.asset_id,
      title: parsed.asset.title,
      subtitle: parsed.asset.subtitle,
      source_name: parsed.asset.source_name,
      source_uri: parsed.asset.source_uri,
      source_tier: parsed.asset.source_tier,
      content_type: parsed.asset.content_type,
      top_group: parsed.asset.top_group,
      group_name: parsed.asset.group_name,
    } : null,
    anchorUnitId: parsed.anchorUnitId,
    anchorChunkId: parsed.anchorChunkId,
    radius: parsed.radius,
    units: Array.isArray(parsed.units)
      ? parsed.units.map(unit => ({
        unit_id: unit.unit_id,
        chunk_id: unit.chunk_id,
        unit_index: unit.unit_index,
        unit_kind: unit.unit_kind,
        heading: unit.heading,
        speaker: unit.speaker,
        scene_code: unit.scene_code,
        text_chars: typeof unit.text === 'string' ? unit.text.length : 0,
      }))
      : [],
  };
}

function compactToolResultForLog(name, result) {
  if (!isMcpTool(name)) return result;
  const originalChars = typeof result === 'string' ? result.length : JSON.stringify(result || '').length;
  const parsed = parseMcpJsonPayload(result);

  if (name === 'mcp_lore-db_lore_db_read') {
    return compactReadResultForLog(parsed, originalChars);
  }

  if (name === 'mcp_lore-db_lore_db_read_context') {
    return compactReadContextResultForLog(parsed, originalChars);
  }

  return result;
}

export function setupChatRoute(app, agentManager, sessionStore, interactionLogger, getActiveDatabase) {
  app.post('/api/chat', async (req, res) => {
    const { sessionId: reqSessionId, message, config, skill, depth, style } = req.body;

    if (!message || !config?.apiKey) {
      res.status(400).json({ error: 'message and config.apiKey are required' });
      return;
    }

    const sessionId = reqSessionId || uuidv4();
    let session = sessionStore.get(sessionId);
    if (!session) {
      session = sessionStore.create(sessionId);
    }

    // Resolve effective skill name: explicit skill override > depth+style mapping > default
    const effectiveDepth = depth || 'quick';
    const effectiveStyle = style || 'dossier';
    const database = req.body.database || (getActiveDatabase ? getActiveDatabase() : 'arknights');
    const effectiveSkill = skill || getSkillName(database, effectiveDepth, effectiveStyle);
    const depthCfg = DEPTH_CONFIG[effectiveDepth] || DEPTH_CONFIG.quick;
    const roundDelayMs = Math.min(Math.max(Math.round(Number(config.roundDelayMs || 0)), 0), 60000);
    const turnId = uuidv4();

    // Merge depth-driven config (maxRounds) into user config
    const effectiveConfig = {
      ...config,
      maxRounds: depthCfg.maxRounds,
      roundDelayMs,
    };

    // Set the resolved skill on the agent
    const agent = agentManager.get(sessionId);
    if (agent) agent.setSkill(effectiveSkill);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Session-Id': sessionId
    });

    const send = (type, data = {}) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    // Store user message
    sessionStore.addMessage(sessionId, { role: 'user', content: message, timestamp: new Date().toISOString() });
    interactionLogger?.write({
      type: 'turn_start',
      turnId,
      sessionId,
      depth: effectiveDepth,
      style: effectiveStyle,
      skill: effectiveSkill,
      maxRounds: depthCfg.maxRounds,
      roundDelayMs,
    });
    interactionLogger?.write({
      type: 'user_message',
      turnId,
      sessionId,
      message,
    });
    send('session', { sessionId });

    let handlers = null;
    try {
      const agentForProcessing = agentManager.getOrCreate(sessionId, effectiveConfig);
      agentForProcessing.setSkill(effectiveSkill);

      let fullText = '';

      handlers = {
        delta: (text) => {
          fullText += text;
          send('delta', { text });
        },

        toolStart: (name, args) => {
          interactionLogger?.write({
            type: 'tool_start',
            turnId,
            sessionId,
            toolName: name,
            isMcp: isMcpTool(name),
            args: parseToolArgs(args),
          });
          send('tool_start', { name, args });
        },

        toolEnd: (name, result) => {
          interactionLogger?.write({
            type: 'tool_end',
            turnId,
            sessionId,
            toolName: name,
            isMcp: isMcpTool(name),
            result: compactToolResultForLog(name, result),
          });
          send('tool_end', { name, result });
        },

        rateWait: (delayMs, round) => {
          interactionLogger?.write({
            type: 'rate_wait',
            turnId,
            sessionId,
            delayMs,
            round,
          });
          send('rate_wait', { delayMs, round });
        },

        error: (message) => {
          interactionLogger?.write({
            type: 'agent_error',
            turnId,
            sessionId,
            message,
          });
          send('error', { message });
        },
      };

      agentForProcessing.on('delta', handlers.delta);
      agentForProcessing.on('tool_start', handlers.toolStart);
      agentForProcessing.on('tool_end', handlers.toolEnd);
      agentForProcessing.on('rate_wait', handlers.rateWait);
      agentForProcessing.on('error', handlers.error);

      await agentForProcessing.processMessage(message);

      if (fullText) {
        sessionStore.addMessage(sessionId, { role: 'assistant', content: fullText, timestamp: new Date().toISOString() });
        interactionLogger?.write({
          type: 'assistant_final',
          turnId,
          sessionId,
          message: fullText,
        });
      }

      interactionLogger?.write({
        type: 'turn_done',
        turnId,
        sessionId,
      });
      send('done', { sessionId });
    } catch (err) {
      interactionLogger?.write({
        type: 'turn_error',
        turnId,
        sessionId,
        message: err.message,
        stack: err.stack,
      });
      send('error', { message: err.message });
    } finally {
      const agentForCleanup = agentManager.get(sessionId);
      if (handlers && agentForCleanup) {
        agentForCleanup.off('delta', handlers.delta);
        agentForCleanup.off('tool_start', handlers.toolStart);
        agentForCleanup.off('tool_end', handlers.toolEnd);
        agentForCleanup.off('rate_wait', handlers.rateWait);
        agentForCleanup.off('error', handlers.error);
      }
      res.end();
    }
  });

  app.post('/api/chat/abort', (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) {
      agentManager.abort(sessionId);
    }
    res.json({ ok: true });
  });
}
