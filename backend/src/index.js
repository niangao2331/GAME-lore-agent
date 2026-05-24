import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';

import { AgentManager } from './AgentManager.js';
import { SessionStore } from './SessionStore.js';
import { ToolRegistry } from './ToolRegistry.js';
import { SkillRegistry } from './SkillRegistry.js';
import { MCPRegistry } from './MCPRegistry.js';
import { setupChatRoute } from './routes/chat.js';
import { setupSessionRoutes } from './routes/sessions.js';
import { setupConfigRoute } from './routes/config.js';
import { setupAdminRoutes } from './routes/admin.js';
import { adminPool, runAdminMigrations } from './adminDb.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = join(__dirname, '..', 'data');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const toolRegistry = new ToolRegistry();
const skillRegistry = new SkillRegistry();
const mcpRegistry = new MCPRegistry(toolRegistry);
const sessionStore = new SessionStore(DATA_DIR);
const agentManager = new AgentManager({ toolRegistry, skillRegistry, sessionStore });

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.use(express.static(join(__dirname, '..', '..', 'frontend')));

app.get('/admin', (_req, res) => {
  res.sendFile(join(__dirname, '..', '..', 'frontend', 'admin.html'));
});

setupChatRoute(app, agentManager, sessionStore);
setupSessionRoutes(app, sessionStore);
setupConfigRoute(app, toolRegistry, skillRegistry, mcpRegistry);
setupAdminRoutes(app);

await runAdminMigrations().then(() => {
  console.log('Admin editor migrations applied');
}).catch(err => {
  console.error('Admin editor migration failed:', err.message);
});

// Auto-register lore-db MCP server
const LORE_DB_MCP_PATH = join(__dirname, '..', 'mcp-servers', 'lore-db-mcp', 'server.js');
if (existsSync(LORE_DB_MCP_PATH)) {
  mcpRegistry.addServer('lore-db', {
    transport: 'stdio',
    command: 'node',
    args: [LORE_DB_MCP_PATH]
  }).then(() => {
    console.log('Lore DB MCP server registered');
  }).catch(err => {
    console.error('Failed to register lore-db MCP server:', err.message);
  });
} else {
  console.warn('Lore DB MCP server not found at:', LORE_DB_MCP_PATH);
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    activeSessions: agentManager.size,
    tools: toolRegistry.size,
    skills: skillRegistry.size,
    mcpServers: mcpRegistry.size,
    modes: ['quick', 'deep'],
    styles: ['dossier', 'research', 'storytelling']
  });
});

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`Iris Web Platform running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  agentManager.destroy();
  sessionStore.save();
  adminPool.end().catch(() => {});
  server.close();
});
process.on('SIGINT', () => {
  agentManager.destroy();
  sessionStore.save();
  adminPool.end().catch(() => {});
  server.close();
});
