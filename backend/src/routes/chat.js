import { v4 as uuidv4 } from 'uuid';
import { getSkillName, DEPTH_CONFIG } from '../depthConfig.js';

export function setupChatRoute(app, agentManager, sessionStore) {
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
    const effectiveSkill = skill || getSkillName(effectiveDepth, effectiveStyle);
    const depthCfg = DEPTH_CONFIG[effectiveDepth] || DEPTH_CONFIG.quick;

    // Merge depth-driven config (maxRounds) into user config
    const effectiveConfig = {
      ...config,
      maxRounds: depthCfg.maxRounds,
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
    send('session', { sessionId });

    try {
      const agentForProcessing = agentManager.getOrCreate(sessionId, effectiveConfig);
      agentForProcessing.setSkill(effectiveSkill);

      let fullText = '';

      agentForProcessing.on('delta', (text) => {
        fullText += text;
        send('delta', { text });
      });

      agentForProcessing.on('tool_start', (name, args) => {
        send('tool_start', { name, args });
      });

      agentForProcessing.on('tool_end', (name, result) => {
        send('tool_end', { name, result });
      });

      agentForProcessing.on('error', (message) => {
        send('error', { message });
      });

      await agentForProcessing.processMessage(message);

      if (fullText) {
        sessionStore.addMessage(sessionId, { role: 'assistant', content: fullText, timestamp: new Date().toISOString() });
      }

      send('done', { sessionId });
    } catch (err) {
      send('error', { message: err.message });
    } finally {
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
