# hmac-cleanup (Plan48 E-5 MUST elevation)

Implements C48-M3 — HMAC key closure pattern with env-var zeroing and
shutdown-flush ordering. Scope qualifier: **within-process scope** per
R3 D-12(b). See `docs/EN/hmac-compliance.md` for the ASVS/NIST mapping.

| Sub-item | Surface |
|----------|---------|
| C48-M3a  | `captureHmacKey()` closure pattern + env-var zero |
| C48-M3b  | `policy.ts` ephemeral key-source enforcement + `isPathInsideSecureStore()` |
| C48-M3c  | `docs/EN/hmac-compliance.md` (+ TW) — ASVS V2.10.1 + NIST SP 800-57 §8.2.2 |
| C48-M3d  | `registerHmacCleanupShutdown()` → W2-R13 shutdown runtime evidence |

## Environment variables

| Name                                | Default                     | Notes                                     |
|-------------------------------------|-----------------------------|-------------------------------------------|
| `OPENSTARRY_CHECKPOINT_HMAC_KEY`    | *(unset — signing disabled)*| Read by `captureHmacKey()`; zeroed immediately. |
| `HMAC_KEY`                          | *(unset — fallback)*        | Secondary env-var name checked after the primary. |
| `OPENSTARRY_SECURE_STORE`           | `<data_dir>/.secrets`       | Only disk path allowed for key material.  |

## Usage

```ts
import {
  captureHmacKey,
  registerHmacCleanupShutdown,
} from 'hmac-cleanup';
import {
  createShutdownHookRegistry,
} from 'audit-infra';

const registry = createShutdownHookRegistry();
const binding = captureHmacKey();          // env zeroed here
if (binding) {
  registerHmacCleanupShutdown(registry, {
    binding,
    onBeforeClear: (sign) => {
      // produce one final shutdown-signing artefact before key clear
      const mac = sign('shutdown:' + Date.now());
      writeArtefact(mac);
    },
  });
}
registry.installSignalHandlers();
```

## What this module does NOT do (D-17a)

- **No key rotation runtime.** See
  `docs/EN/hmac-key-rotation-architecture.md` — Plan48 ships design-only;
  runtime implementation deferred to a future cycle.
- **No secure-store I/O.** Policy helpers only (`isPathInsideSecureStore`).
- **No out-of-process scope.** Within-process scope only (D-12b).
