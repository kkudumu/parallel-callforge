import { describe, it, expect } from "@jest/globals";
import { createDbClient } from "./client.js";

describe("createDbClient", () => {
  it("creates a pool with the given connection string", () => {
    const client = createDbClient("postgres://user:pass@localhost:5432/testdb");
    expect(client).toBeDefined();
    expect(client.query).toBeDefined();
    expect(client.end).toBeDefined();
  });
});
