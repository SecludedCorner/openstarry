import { describe, it, expect, beforeEach } from "vitest";
import { GlobalServiceRegistry } from "../../src/daemon/global-service-registry.js";

describe("C13 — GlobalServiceRegistry (Plan37, D2-R7)", () => {
  let registry: GlobalServiceRegistry;

  beforeEach(() => {
    registry = new GlobalServiceRegistry();
  });

  it("register + lookup returns the registration", () => {
    registry.register("auth-service", "agent-a", { version: "1.0" });
    const results = registry.lookup("auth-service");

    expect(results).toHaveLength(1);
    expect(results[0].serviceName).toBe("auth-service");
    expect(results[0].agentId).toBe("agent-a");
    expect(results[0].metadata).toEqual({ version: "1.0" });
    expect(results[0].registeredAt).toBeGreaterThan(0);
  });

  it("deregisterAgent removes all services for that agent", () => {
    registry.register("svc-1", "agent-a");
    registry.register("svc-2", "agent-a");
    registry.register("svc-1", "agent-b");

    registry.deregisterAgent("agent-a");

    expect(registry.lookup("svc-1")).toHaveLength(1);
    expect(registry.lookup("svc-1")[0].agentId).toBe("agent-b");
    expect(registry.lookup("svc-2")).toHaveLength(0);
  });

  it("lookup returns empty array for unknown service", () => {
    const results = registry.lookup("nonexistent-service");
    expect(results).toEqual([]);
  });

  it("duplicate registration from same agent replaces previous", () => {
    registry.register("svc-x", "agent-a", { v: 1 });
    registry.register("svc-x", "agent-a", { v: 2 });

    const results = registry.lookup("svc-x");
    expect(results).toHaveLength(1);
    expect(results[0].metadata).toEqual({ v: 2 });
  });

  it("listAll returns all services", () => {
    registry.register("svc-1", "agent-a");
    registry.register("svc-2", "agent-b");
    registry.register("svc-1", "agent-c");

    const all = registry.listAll();
    expect(all).toHaveLength(3);

    const agentIds = all.map(r => r.agentId).sort();
    expect(agentIds).toEqual(["agent-a", "agent-b", "agent-c"]);
  });
});
