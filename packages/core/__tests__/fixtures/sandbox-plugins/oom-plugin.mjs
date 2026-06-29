/**
 * Malicious fixture: allocates retained memory in an unbounded loop to exceed the
 * worker's V8 old-generation heap limit (resourceLimits.maxOldGenerationSizeMb). The
 * e2e loads it with a small custom memoryLimitMb (≠ the 512 default) so the manager
 * takes the DEDICATED-worker path with real resourceLimits, then expects
 * SANDBOX_MEMORY_LIMIT_EXCEEDED (exit 134/null) or SANDBOX_WORKER_CRASHED.
 */
export default function createOomPlugin() {
  return {
    manifest: { name: "fixture-oom", version: "1.0.0", sandbox: { enabled: true } },
    async factory() {
      return {
        tools: [
          {
            skandha: "samskara",
            id: "oom.allocate",
            description: "Allocates retained memory until the worker heap limit is exceeded.",
            parameters: { parse: (v) => v },
            async execute() {
              const sink = [];
              // Each entry is ~8MB (1e6 doubles), retained in `sink` so it lands in old-gen.
              for (;;) {
                sink.push(new Array(1_000_000).fill(sink.length));
              }
            },
          },
        ],
      };
    },
  };
}
