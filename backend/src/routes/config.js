export function setupConfigRoute(app, toolRegistry, skillRegistry, mcpRegistry) {
  app.get('/api/config', (_req, res) => {
    res.json({
      tools: toolRegistry.getAll(),
      skills: skillRegistry.getAll(),
      mcpServers: mcpRegistry.getServers()
    });
  });

  app.post('/api/config/mcp', async (req, res) => {
    const { id, config } = req.body;
    if (!id || !config) {
      res.status(400).json({ error: 'id and config are required' });
      return;
    }
    try {
      await mcpRegistry.addServer(id, config);
      res.json({ ok: true, servers: mcpRegistry.getServers() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/config/mcp/:id', async (req, res) => {
    try {
      await mcpRegistry.removeServer(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
