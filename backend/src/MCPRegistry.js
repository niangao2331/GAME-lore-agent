import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: config.env || undefined
      });

      const client = new Client(
        { name: 'iris-web-platform', version: '1.0.0' },
        { capabilities: {} }
      );

      await client.connect(transport);
      this.clients.set(id, { client, transport });

      const { tools } = await client.listTools();
      for (const tool of tools) {
        // MCP tools are namespaced before registration so server switches cannot
        // collide with local application tools or tools from other MCP servers.
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

  getServers() {
    return Array.from(this.servers.values());
  }

  async removeServer(id) {
    const server = this.servers.get(id);
    if (server?.status === 'connected') {
      const clientEntry = this.clients.get(id);
      if (clientEntry) {
        try {
          // Unregister tools by asking the still-connected server for the same
          // tool list that was used during registration.
          const { tools } = await clientEntry.client.listTools();
          for (const tool of tools) {
            this.toolRegistry.unregister(`mcp_${id}_${tool.name}`);
          }
        } catch {
          // Best-effort cleanup
        }
        try {
          await clientEntry.transport.close();
        } catch {
          // Ignore close errors
        }
        this.clients.delete(id);
      }
    }
    this.servers.delete(id);
  }

  async switchServer(id, config) {
    await this.removeServer(id);
    return this.addServer(id, config);
  }

  get size() {
    return this.servers.size;
  }
}
