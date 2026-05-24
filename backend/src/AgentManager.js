import { Agent } from './Agent.js';

export class AgentManager {
  constructor({ toolRegistry, skillRegistry, sessionStore }) {
    this.agents = new Map();
    this.toolRegistry = toolRegistry;
    this.skillRegistry = skillRegistry;
    this.sessionStore = sessionStore;
    this.idleTimeout = 30 * 60 * 1000; // 30 minutes
    this._timers = new Map();
  }

  getOrCreate(sessionId, config) {
    let agent = this.agents.get(sessionId);
    if (agent) {
      agent.updateConfig(config);
      this._resetTimer(sessionId);
      return agent;
    }

    agent = new Agent(sessionId, config, {
      toolRegistry: this.toolRegistry,
      skillRegistry: this.skillRegistry
    });

    this.agents.set(sessionId, agent);
    this._resetTimer(sessionId);
    return agent;
  }

  get(sessionId) {
    return this.agents.get(sessionId) || null;
  }

  async processMessage(sessionId, userMessage, config) {
    const agent = this.getOrCreate(sessionId, config);
    return agent.processMessage(userMessage);
  }

  async abort(sessionId) {
    const agent = this.agents.get(sessionId);
    if (agent) agent.abort();
  }

  remove(sessionId) {
    const agent = this.agents.get(sessionId);
    if (agent) {
      agent.abort();
      this.agents.delete(sessionId);
    }
    this._clearTimer(sessionId);
  }

  _resetTimer(sessionId) {
    this._clearTimer(sessionId);
    const timer = setTimeout(() => {
      this.remove(sessionId);
    }, this.idleTimeout);
    this._timers.set(sessionId, timer);
  }

  _clearTimer(sessionId) {
    const timer = this._timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(sessionId);
    }
  }

  get size() {
    return this.agents.size;
  }

  destroy() {
    for (const [id] of this.agents) {
      this.remove(id);
    }
  }
}
