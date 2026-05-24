export function setupSessionRoutes(app, sessionStore) {
  app.get('/api/sessions', (_req, res) => {
    const sessions = sessionStore.getAll().map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length
    }));
    res.json(sessions);
  });

  app.get('/api/sessions/:id', (req, res) => {
    const session = sessionStore.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  });

  app.delete('/api/sessions/:id', (req, res) => {
    sessionStore.delete(req.params.id);
    res.json({ ok: true });
  });

  app.patch('/api/sessions/:id', (req, res) => {
    const { title } = req.body;
    if (title) {
      sessionStore.updateTitle(req.params.id, title);
    }
    res.json({ ok: true });
  });
}
