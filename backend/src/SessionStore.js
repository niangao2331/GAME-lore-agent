import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

export class SessionStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = join(dataDir, 'sessions.json');
    this.sessions = new Map();
    this._load();
  }

  _load() {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
        for (const s of data) {
          this.sessions.set(s.id, s);
        }
      }
    } catch {
      // corrupted file, start fresh
    }
  }

  save() {
    const data = Array.from(this.sessions.values());
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  create(id, title = 'New Chat') {
    const sessionId = id || uuidv4();
    const session = {
      id: sessionId,
      title,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.sessions.set(session.id, session);
    this.save();
    return session;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  getAll() {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  addMessage(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.messages.push(message);
    session.updatedAt = new Date().toISOString();

    // Auto-title from first user message
    if (session.title === 'New Chat' && message.role === 'user') {
      session.title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
    }

    this.save();
    return session;
  }

  delete(id) {
    this.sessions.delete(id);
    this.save();
  }
}
