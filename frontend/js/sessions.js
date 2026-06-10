const Sessions = {
  async list() {
    const res = await fetch('/api/sessions');
    return res.json();
  },

  async get(id) {
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) return null;
    return res.json();
  },

  async remove(id) {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  }
};
