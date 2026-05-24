import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export class MCPRegistry {
  constructor(toolRegistry) {
    this.toolRegistry = toolRegistry;
    this.servers = new Map();
    this.clients = new Map();
  }

  async addServer(id, config) {
    if (this.servers.has(id)) {
      throw new Error(`MCP server "${id}" already configured`);
    }

    this.servers.set(id, { id, ...config, status: 'connecting' });

    try {
      let transport;
      if (config.transport === 'stdio') {
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || []
        });
      } else if (config.transport === 'http') {
        transport = new StreamableHTTPClientTransport(new URL(config.url));
      } else {
        throw new Error(`Unsupported transport: ${config.transport}`);
      }

      const client = new Client(
        { name: 'iris-web-platform', version: '1.0.0' },
        { capabilities: {} }
      );

      await client.connect(transport);
      this.clients.set(id, { client, transport });

      const { tools } = await client.listTools();
      for (const tool of tools) {
        const mcpTool = {
          name: `mcp_${id}_${tool.name}`,
          description: `[MCP:${id}] ${tool.description || tool.name}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
          handler: async (args) => {
            const result = await client.callTool({ name: tool.name, arguments: args });
            const text = result.content.map(c => c.text || JSON.stringify(c)).join('\n');
            if (id === 'lore-db') {
              return `${text}\n\n[WORKFLOW REMINDER] Before making another lore-db search/read batch or final answer, call lore_analysis_checkpoint to analyze what this result changes, what remains uncertain, and what the next targeted search should be.`;
            }
            return text;
          }
        };
        this.toolRegistry.register(mcpTool);
      }

      this.servers.set(id, { ...this.servers.get(id), status: 'connected', toolCount: tools.length });
      console.log(`MCP server "${id}" connected with ${tools.length} tools`);
    } catch (e) {
      this.servers.set(id, { ...this.servers.get(id), status: 'error', error: e.message });
      console.error(`MCP server "${id}" connection failed: ${e.message}`);
    }
  }

  async removeServer(id) {
    const entry = this.clients.get(id);
    if (entry) {
      await entry.client.close().catch(() => {});
      this.clients.delete(id);
    }

    // Remove registered tools for this server
    for (const [toolName] of this.toolRegistry.tools) {
      if (toolName.startsWith(`mcp_${id}_`)) {
        this.toolRegistry.unregister(toolName);
      }
    }

    this.servers.delete(id);
  }

  getServers() {
    return Array.from(this.servers.values());
  }

  get size() {
    return this.servers.size;
  }

  async shutdown() {
    for (const [id] of this.clients) {
      await this.removeServer(id);
    }
  }
}
