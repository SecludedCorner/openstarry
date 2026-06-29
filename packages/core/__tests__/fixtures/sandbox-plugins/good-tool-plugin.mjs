/**
 * Well-behaved low-trust sample plugin for the REAL-worker sandbox e2e.
 * Committed as dependency-free ESM .mjs so a real Worker can `import()` it with no
 * build step. `parameters` is a zod-free shim exposing the .parse() the worker calls.
 */
export default function createGoodPlugin() {
  return {
    manifest: { name: "fixture-good", version: "1.0.0", sandbox: { enabled: true } },
    async factory() {
      return {
        tools: [
          {
            skandha: "samskara",
            id: "echo.upper",
            description: "Uppercases input.text (pure compute, no imports).",
            parameters: { parse: (v) => v },
            async execute(input) {
              return String(input?.text ?? "").toUpperCase();
            },
          },
        ],
      };
    },
  };
}
