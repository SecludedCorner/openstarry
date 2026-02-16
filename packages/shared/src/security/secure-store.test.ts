import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SecureStore } from "./secure-store.js";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("SecureStore", () => {
  let tempDir: string;
  let store: SecureStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "securestore-test-"));
    store = new SecureStore({ basePath: tempDir, saltSuffix: "test-plugin" });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── ensureDir ───

  describe("ensureDir()", () => {
    it("creates the base directory if it does not exist", async () => {
      const nested = join(tempDir, "a", "b", "c");
      const s = new SecureStore({ basePath: nested });
      await s.ensureDir();
      // write should not throw
      await s.write("test.json", { ok: true });
      const result = await s.read<{ ok: boolean }>("test.json");
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── Plain read / write / delete ───

  describe("read() / write() / delete()", () => {
    it("writes and reads plain JSON", async () => {
      const data = { name: "test", values: [1, 2, 3] };
      await store.write("plain.json", data);
      const result = await store.read<typeof data>("plain.json");
      expect(result).toEqual(data);
    });

    it("returns null for missing file", async () => {
      const result = await store.read("nonexistent.json");
      expect(result).toBeNull();
    });

    it("deletes a file", async () => {
      await store.write("delete-me.json", { x: 1 });
      await store.delete("delete-me.json");
      const result = await store.read("delete-me.json");
      expect(result).toBeNull();
    });

    it("delete does not throw for missing file", async () => {
      await expect(store.delete("nope.json")).resolves.toBeUndefined();
    });

    it("writes valid JSON with indentation", async () => {
      await store.write("formatted.json", { a: 1 });
      const raw = await readFile(join(tempDir, "formatted.json"), "utf-8");
      expect(raw).toContain("\n"); // Pretty-printed
      expect(JSON.parse(raw)).toEqual({ a: 1 });
    });
  });

  // ─── Encrypted read / write ───

  describe("readSecure() / writeSecure()", () => {
    it("encrypts and decrypts data round-trip", async () => {
      const secret = { apiKey: "sk-test-12345", token: "abc" };
      await store.writeSecure("creds.enc.json", secret);
      const result = await store.readSecure<typeof secret>("creds.enc.json");
      expect(result).toEqual(secret);
    });

    it("stored file is encrypted (not plain text)", async () => {
      const secret = { apiKey: "sk-very-secret-key" };
      await store.writeSecure("encrypted.json", secret);
      const raw = await readFile(join(tempDir, "encrypted.json"), "utf-8");
      expect(raw).not.toContain("sk-very-secret-key");
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveProperty("iv");
      expect(parsed).toHaveProperty("tag");
      expect(parsed).toHaveProperty("salt");
      expect(parsed).toHaveProperty("data");
    });

    it("returns null for missing encrypted file", async () => {
      const result = await store.readSecure("nonexistent.enc.json");
      expect(result).toBeNull();
    });

    it("handles complex nested objects", async () => {
      const data = {
        tokens: { access: "a", refresh: "r" },
        nested: { deep: { value: 42 } },
        array: [1, "two", { three: true }],
      };
      await store.writeSecure("complex.enc.json", data);
      const result = await store.readSecure<typeof data>("complex.enc.json");
      expect(result).toEqual(data);
    });

    it("handles string values", async () => {
      await store.writeSecure("str.enc.json", "just-a-string");
      const result = await store.readSecure<string>("str.enc.json");
      expect(result).toBe("just-a-string");
    });

    it("different saltSuffix produces different encryption", async () => {
      const store2 = new SecureStore({ basePath: tempDir, saltSuffix: "other-plugin" });
      const secret = { key: "shared-secret" };

      await store.writeSecure("same-file.enc.json", secret);

      // Read with different saltSuffix should fail
      const result = await store2.readSecure<typeof secret>("same-file.enc.json");
      // Decryption fails → file gets deleted → returns null
      expect(result).toBeNull();
    });
  });

  // ─── Legacy migration ───

  describe("legacy unencrypted migration", () => {
    it("auto-encrypts legacy unencrypted data", async () => {
      // Write plain (unencrypted) data as if from old version
      await store.write("legacy.json", { apiKey: "old-key" });

      // readSecure should detect it's not encrypted, re-encrypt, and return data
      const result = await store.readSecure<{ apiKey: string }>("legacy.json");
      expect(result).toEqual({ apiKey: "old-key" });

      // File should now be encrypted
      const raw = await readFile(join(tempDir, "legacy.json"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveProperty("iv");
      expect(parsed).toHaveProperty("tag");
      expect(parsed).toHaveProperty("salt");
      expect(parsed).toHaveProperty("data");
    });
  });

  // ─── Default saltSuffix ───

  describe("default options", () => {
    it("uses 'openstarry' as default saltSuffix", async () => {
      const defaultStore = new SecureStore({ basePath: tempDir });
      const data = { test: true };
      await defaultStore.writeSecure("default.enc.json", data);
      const result = await defaultStore.readSecure<typeof data>("default.enc.json");
      expect(result).toEqual(data);
    });
  });

  // ─── Concurrent writes to different files ───

  describe("concurrent writes", () => {
    it("concurrent writeSecure to different files all succeed", async () => {
      const writes = Array.from({ length: 10 }, (_, i) =>
        store.writeSecure(`concurrent-${i}.enc.json`, { index: i, data: `value-${i}` }),
      );
      await Promise.all(writes);

      // Verify all files are readable
      for (let i = 0; i < 10; i++) {
        const result = await store.readSecure<{ index: number; data: string }>(
          `concurrent-${i}.enc.json`,
        );
        expect(result).toEqual({ index: i, data: `value-${i}` });
      }
    });

    it("concurrent readSecure from different files all succeed", async () => {
      // Prepare files
      for (let i = 0; i < 5; i++) {
        await store.writeSecure(`read-${i}.enc.json`, { value: i });
      }

      // Read all concurrently
      const reads = Array.from({ length: 5 }, (_, i) =>
        store.readSecure<{ value: number }>(`read-${i}.enc.json`),
      );
      const results = await Promise.all(reads);

      for (let i = 0; i < 5; i++) {
        expect(results[i]).toEqual({ value: i });
      }
    });
  });

  // ─── File lock concurrency ───

  describe("file lock concurrency", () => {
    it("concurrent writeSecure to same file serializes without corruption", async () => {
      const writes = Array.from({ length: 10 }, (_, i) =>
        store.writeSecure("same-file.enc.json", { index: i }),
      );
      await Promise.all(writes);

      // File should be readable and contain one of the written values
      const result = await store.readSecure<{ index: number }>("same-file.enc.json");
      expect(result).not.toBeNull();
      expect(result!.index).toBeGreaterThanOrEqual(0);
      expect(result!.index).toBeLessThan(10);
    });

    it("no .lock files remain after operations", async () => {
      await store.writeSecure("locktest.enc.json", { a: 1 });
      await store.readSecure("locktest.enc.json");
      await store.delete("locktest.enc.json");

      const files = await readdir(tempDir);
      const lockFiles = files.filter((f) => f.endsWith(".lock"));
      expect(lockFiles).toHaveLength(0);
    });

    it("concurrent readSecure with legacy migration does not corrupt", async () => {
      // Write plain (unencrypted) data
      await store.write("legacy-concurrent.json", { key: "value" });

      // Multiple concurrent readSecure calls — each may trigger migration
      const reads = Array.from({ length: 5 }, () =>
        store.readSecure<{ key: string }>("legacy-concurrent.json"),
      );
      const results = await Promise.all(reads);

      for (const r of results) {
        expect(r).toEqual({ key: "value" });
      }
    });
  });

  // ─── Overwrite behavior ───

  describe("overwrite", () => {
    it("writeSecure overwrites previous encrypted data", async () => {
      await store.writeSecure("overwrite.enc.json", { v: 1 });
      await store.writeSecure("overwrite.enc.json", { v: 2 });
      const result = await store.readSecure<{ v: number }>("overwrite.enc.json");
      expect(result).toEqual({ v: 2 });
    });

    it("write overwrites previous plain data", async () => {
      await store.write("overwrite.json", { v: 1 });
      await store.write("overwrite.json", { v: 2 });
      const result = await store.read<{ v: number }>("overwrite.json");
      expect(result).toEqual({ v: 2 });
    });
  });
});
