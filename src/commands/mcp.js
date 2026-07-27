import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DEFINITIONS, dispatchTool, allowedPathsWarning } from "../mcp/tools.js";
import { FILECAP_VERSION } from "../version.js";

/**
 * Start an stdio MCP server that exposes filecap's commands as tools.
 * Returns a promise that resolves when the server connects to stdio.
 *
 * In normal CLI usage this never resolves — the server runs until the
 * MCP client disconnects (typically by closing stdin).
 */
export async function runMcp() {
  // v1.40.0 — never run silently unrestricted (stderr is safe: MCP speaks
  // JSON-RPC over stdout only).
  const warning = allowedPathsWarning();
  if (warning) process.stderr.write(warning + "\n");
  const server = new Server(
    { name: "filecap", version: FILECAP_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return dispatchTool(name, args ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
