const Config = {
  _key: 'iris_config',

  defaults: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    protocol: 'openai',
    depth: 'quick',
    style: 'dossier',
    roundDelayMs: 0,
    fontSize: 13,
    chatWidth: 100
  },

  get() {
    try {
      const saved = localStorage.getItem(this._key);
      if (saved) return { ...this.defaults, ...JSON.parse(saved) };
    } catch {}
    return { ...this.defaults };
  },

  set(updates) {
    const config = { ...this.get(), ...updates };
    localStorage.setItem(this._key, JSON.stringify(config));
    return config;
  },

  clear() {
    localStorage.removeItem(this._key);
  },

  isValid() {
    const cfg = this.get();
    return cfg.apiKey && cfg.apiKey.length > 0;
  }
};
