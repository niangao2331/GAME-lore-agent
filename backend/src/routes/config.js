export function setupConfigRoute(app, toolRegistry, skillRegistry, mcpRegistry, databases, getActiveDatabase) {
  app.get('/api/config', (_req, res) => {
    res.json({
      tools: toolRegistry.getAll(),
      skills: skillRegistry.getAll(),
      mcpServers: mcpRegistry.getServers(),
      databases: Object.values(databases || {}).map(db => ({ id: db.id, name: db.name })),
      activeDatabase: getActiveDatabase ? getActiveDatabase() : 'arknights'
    });
  });
}
