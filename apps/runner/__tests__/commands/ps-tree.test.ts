/**
 * Ps --tree Command Tests — Process Tree rendering (Doc 13).
 *
 * Covers the pure renderer (toRenderTreeNodes / collectChildIds /
 * renderProcessTreeLines) and the printTree path with a mocked IPC client,
 * asserting it queries `agent.processTree` and renders the indented hierarchy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProcessTreeNode } from "../../src/daemon/types.js";

// Hoisted spy so the vi.mock factory (hoisted above imports) can reference it.
const { callSpy } = vi.hoisted(() => ({ callSpy: vi.fn() }));

vi.mock("../../src/daemon/ipc-client.js", () => ({
  IPCClientImpl: class {
    constructor(_opts: unknown) {}
    async connect(): Promise<void> {
      /* mocked connect — no real socket */
    }
    async call(method: string): Promise<unknown> {
      callSpy(method);
      // Two-level tree: root → child (a grandchild would be depth 2).
      return [
        {
          entry: mkEntry("root-agent", 100, "running", ["child-a"]),
          children: [
            {
              entry: mkEntry("child-a", 200, "running", []),
              children: [],
            },
          ],
        },
      ] satisfies ProcessTreeNode[];
    }
    close(): void {
      /* no-op */
    }
    on(): void {
      /* no-op */
    }
  },
}));

function mkEntry(
  agentId: string,
  pid: number,
  status: "running" | "draining" | "terminated" | "stopped" | "unknown",
  childAgentIds: string[]
) {
  return {
    agentId,
    pid,
    status,
    configPath: "",
    socketPath: "",
    logFile: "",
    uptime: 0,
    childAgentIds,
  };
}

// Import after vi.mock so the mocked IPC client is wired in.
import {
  PsCommand,
  toRenderTreeNodes,
  collectChildIds,
  renderProcessTreeLines,
  type RenderTreeNode,
} from "../../src/commands/ps.js";

describe("ps --tree — pure renderer", () => {
  const sampleForest: ProcessTreeNode[] = [
    {
      entry: mkEntry("root", 1, "running", ["c1"]),
      children: [
        {
          entry: mkEntry("c1", 2, "running", ["g1"]),
          children: [{ entry: mkEntry("g1", 3, "draining", []), children: [] }],
        },
      ],
    },
  ];

  it("maps ProcessTreeNode[] to RenderTreeNode[] preserving hierarchy", () => {
    const rendered = toRenderTreeNodes(sampleForest);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].agentId).toBe("root");
    expect(rendered[0].children[0].agentId).toBe("c1");
    expect(rendered[0].children[0].children[0].agentId).toBe("g1");
    expect(rendered[0].children[0].children[0].status).toBe("draining");
  });

  it("collectChildIds returns every non-root agentId", () => {
    const ids = collectChildIds(toRenderTreeNodes(sampleForest));
    expect(ids.has("root")).toBe(false);
    expect(ids.has("c1")).toBe(true);
    expect(ids.has("g1")).toBe(true);
  });

  it("renders indentation and depth per level", () => {
    const lines = renderProcessTreeLines(toRenderTreeNodes(sampleForest));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("root (pid 1) [running] depth=0");
    expect(lines[1]).toBe("  c1 (pid 2) [running] depth=1");
    expect(lines[2]).toBe("    g1 (pid 3) [draining] depth=2");
  });

  it("empty forest renders no lines", () => {
    expect(renderProcessTreeLines([])).toEqual([]);
  });
});

describe("ps --tree — printTree via IPC", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    callSpy.mockClear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("queries agent.processTree and renders the hierarchy", async () => {
    const cmd = new PsCommand();
    const exitCode = await cmd.printTree([
      { agentId: "root-agent", pid: 100, pidFile: "/tmp/root-agent.pid" },
    ]);

    expect(exitCode).toBe(0);
    expect(callSpy).toHaveBeenCalledWith("agent.processTree");

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("PROCESS TREE");
    expect(output).toContain("root-agent (pid 100) [running] depth=0");
    expect(output).toContain("  child-a (pid 200) [running] depth=1");
    expect(output).toContain("1 daemon(s) queried");
  });

  it("folds a child daemon's self-reported root under its parent (no duplicate)", async () => {
    const cmd = new PsCommand();
    // Both the root daemon and the child daemon are in the running list; each
    // returns the same two-level tree from the mock, so child-a is reported as
    // both a child (under root) and (potentially) a standalone root.
    await cmd.printTree([
      { agentId: "root-agent", pid: 100, pidFile: "/tmp/root-agent.pid" },
      { agentId: "child-a", pid: 200, pidFile: "/tmp/child-a.pid" },
    ]);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // child-a must appear exactly once, indented under root-agent.
    const childOccurrences = output.split("\n").filter((l) => l.includes("child-a")).length;
    expect(childOccurrences).toBe(1);
    expect(output).toContain("  child-a (pid 200) [running] depth=1");
    expect(output).toContain("2 daemon(s) queried");
  });
});

describe("ps --tree — IPC failure fallback", () => {
  it("renders a flat unknown-status node when the RPC payload is empty", () => {
    // collectChildIds + renderProcessTreeLines on a fallback node.
    const fallback: RenderTreeNode[] = [
      { agentId: "unreachable", pid: 999, status: "unknown", children: [] },
    ];
    const lines = renderProcessTreeLines(fallback);
    expect(lines).toEqual(["unreachable (pid 999) [unknown] depth=0"]);
  });
});

describe("ps --tree — name + generation (Spec Addendum A)", () => {
  it("shows a human name [id] and gen= when present", () => {
    const nodes: RenderTreeNode[] = [
      {
        agentId: "root",
        pid: 1,
        status: "running",
        children: [
          { agentId: "root-1", pid: 2, status: "running", name: "worker", generation: 1, children: [] },
        ],
      },
    ];
    const lines = renderProcessTreeLines(nodes);
    expect(lines[0]).toBe("root (pid 1) [running] depth=0"); // root has no name/gen → unchanged
    expect(lines[1]).toBe("  worker [root-1] (pid 2) [running] gen=1 depth=1");
  });

  it("omits the [id] suffix when name equals the id, but still shows gen", () => {
    const nodes: RenderTreeNode[] = [
      { agentId: "root-2", pid: 3, status: "running", name: "root-2", generation: 2, children: [] },
    ];
    expect(renderProcessTreeLines(nodes)).toEqual(["root-2 (pid 3) [running] gen=2 depth=0"]);
  });

  it("is backward-compatible: nodes without name/generation render exactly as before", () => {
    const nodes: RenderTreeNode[] = [{ agentId: "a", pid: 9, status: "running", children: [] }];
    expect(renderProcessTreeLines(nodes)).toEqual(["a (pid 9) [running] depth=0"]);
  });
});
