import { createServer } from 'http';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';

import { AgentManager } from './AgentManager.js';
import { SessionStore } from './SessionStore.js';
import { InteractionLogger } from './InteractionLogger.js';
import { ToolRegistry } from './ToolRegistry.js';
import { SkillRegistry } from './SkillRegistry.js';
import { MCPRegistry } from './MCPRegistry.js';
import { setupChatRoute } from './routes/chat.js';
import { setupSessionRoutes } from './routes/sessions.js';
import { setupConfigRoute } from './routes/config.js';
import { setupAdminRoutes } from './routes/admin.js';
import { adminPool, runAdminMigrations } from './adminDb.js';
import { prepareDatabase } from './dbMaintenance.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = join(__dirname, '..', 'data');
const PROJECT_ROOT = join(__dirname, '..', '..');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const toolRegistry = new ToolRegistry();
const skillRegistry = new SkillRegistry();
const mcpRegistry = new MCPRegistry(toolRegistry);
const sessionStore = new SessionStore(DATA_DIR);
const interactionLogger = new InteractionLogger(DATA_DIR);
const agentManager = new AgentManager({ toolRegistry, skillRegistry, sessionStore });

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.use(express.static(join(__dirname, '..', '..', 'frontend')));

app.get('/admin', (_req, res) => {
  res.sendFile(join(__dirname, '..', '..', 'frontend', 'admin.html'));
});

const DB_REGISTRY_PATH = join(__dirname, '..', '..', 'database', 'databases.json');
let DATABASES = {};
try {
  const raw = readFileSync(DB_REGISTRY_PATH, 'utf-8');
  const registry = JSON.parse(raw);
  for (const db of registry.databases || []) {
    // Every registered dump is exposed through the same lore-db MCP server;
    // switching databases only changes the PostgreSQL environment.
    DATABASES[db.id] = {
      ...db,
      mcpConfig: { transport: 'stdio', command: 'node', args: [join(__dirname, '..', 'mcp-servers', 'lore-db-mcp', 'server.js')] }
    };
  }
} catch (err) {
  console.error('Failed to load database registry:', err.message);
  DATABASES = {
    arknights: {
      id: 'arknights',
      name: '明日方舟资料库',
      mcpConfig: { transport: 'stdio', command: 'node', args: [join(__dirname, '..', 'mcp-servers', 'lore-db-mcp', 'server.js')] },
      env: { PGDATABASE: process.env.PGDATABASE || 'arknights_lore_new' }
    }
  };
}

let activeDatabaseId = Object.keys(DATABASES)[0] || 'arknights';

// Apply the default database environment before migrations and MCP startup so
// both the admin routes and the initial MCP child process point at the same DB.
const DEFAULT_DB = DATABASES[activeDatabaseId];
if (DEFAULT_DB.env) {
  for (const [key, value] of Object.entries(DEFAULT_DB.env)) {
    process.env[key] = value;
  }
}

setupChatRoute(app, agentManager, sessionStore, interactionLogger, () => activeDatabaseId);
setupSessionRoutes(app, sessionStore);
setupConfigRoute(app, toolRegistry, skillRegistry, mcpRegistry, DATABASES, () => activeDatabaseId);
setupAdminRoutes(app);

async function prepareRegisteredDatabase(db) {
  const dumpPath = db.dumpFile ? join(PROJECT_ROOT, 'database', db.dumpFile) : null;
  const optimizationSqlPath = join(PROJECT_ROOT, 'backend', 'mcp-servers', 'lore-db-mcp', 'migrations', '004_query_optimization.sql');
  try {
    const result = await prepareDatabase(db, { dumpPath, optimizationSqlPath });
    const health = result.maintenance.after;
    const actionText = result.maintenance.actions.length ? result.maintenance.actions.join(', ') : 'none';
    console.log(`[DB] ${result.database}: ${result.restored ? 'restored from dump' : 'existing database preserved'}; maintenance=${actionText}; healthy=${health.healthy}`);
    if (health.warnings.length) {
      console.warn(`[DB] ${result.database} warnings: ${health.warnings.join(', ')}`);
    }
    return result;
  } catch (err) {
    console.error(`[DB] Failed to prepare "${db.id}": ${err.message}`);
    return null;
  }
}

for (const db of Object.values(DATABASES)) {
  await prepareRegisteredDatabase(db);
}

await runAdminMigrations().then(() => {
  console.log('Admin editor migrations applied');
}).catch(err => {
  console.error('Admin editor migration failed:', err.message);
});

// Auto-register lore-db MCP server for the default database
const LORE_DB_MCP_PATH = join(__dirname, '..', 'mcp-servers', 'lore-db-mcp', 'server.js');
if (existsSync(LORE_DB_MCP_PATH)) {
  const mcpServerConfig = { ...DEFAULT_DB.mcpConfig, env: DEFAULT_DB.env };
  mcpRegistry.addServer('lore-db', mcpServerConfig).then(() => {
    console.log(`Lore DB MCP server registered for ${DEFAULT_DB.name}`);
  }).catch(err => {
    console.error('Failed to register lore-db MCP server:', err.message);
  });
} else {
  console.warn('Lore DB MCP server not found at:', LORE_DB_MCP_PATH);
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    activeDatabase: activeDatabaseId,
    databases: Object.values(DATABASES).map(db => ({ id: db.id, name: db.name })),
    activeSessions: agentManager.size,
    tools: toolRegistry.size,
    skills: skillRegistry.size,
    mcpServers: mcpRegistry.size,
    modes: ['quick', 'deep', 'structured'],
    styles: ['dossier'],
    rag: {
      available: false,
      enabled: false,
      stages: [],
    }
  });
});

app.post('/api/database/switch', async (req, res) => {
  const { databaseId } = req.body;
  const dbConfig = DATABASES[databaseId];
  if (!dbConfig) {
    res.status(400).json({ error: `Unknown database: ${databaseId}` });
    return;
  }

  try {
    const preparation = await prepareRegisteredDatabase(dbConfig);
    if (!preparation) {
      res.status(500).json({ error: `Prepare failed: ${databaseId}` });
      return;
    }

    // Update environment for MCP server
    if (dbConfig.env) {
      for (const [key, value] of Object.entries(dbConfig.env)) {
        process.env[key] = value;
      }
    }

    // Switch MCP server
    const switchMcpConfig = { ...dbConfig.mcpConfig, env: dbConfig.env };
    await mcpRegistry.switchServer('lore-db', switchMcpConfig);
    activeDatabaseId = databaseId;

    res.json({
      ok: true,
      database: databaseId,
      name: dbConfig.name,
      health: preparation.maintenance.after,
      maintenanceActions: preparation.maintenance.actions,
    });
  } catch (err) {
    console.error('Database switch failed:', err.message);
    res.status(500).json({ error: `Switch failed: ${err.message}` });
  }
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
