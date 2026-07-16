import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_INSTRUCTIONS } from "../src/instructions.js";

describe("server instructions", () => {
  it("are accepted by the pinned McpServer options and contain the essential op_run rules", () => {
    expect(() => new McpServer(
      { name: "test", version: "0.0.0" },
      { instructions: SERVER_INSTRUCTIONS },
    )).not.toThrow();
    expect(SERVER_INSTRUCTIONS).toMatch(/argv.*no shell/is);
    expect(SERVER_INSTRUCTIONS).toMatch(/cmd\.exe.*%VAR%.*powershell.*\$env:VAR/is);
    expect(SERVER_INSTRUCTIONS).toMatch(/bare bash.*WSL/is);
    expect(SERVER_INSTRUCTIONS).toMatch(/env values/is);
    expect(SERVER_INSTRUCTIONS).toMatch(/Redaction.*only/is);
  });
});
