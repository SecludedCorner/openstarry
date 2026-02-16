/**
 * SecureStore — Shared encrypted file storage with AES-256-GCM + PBKDF2 machine-binding.
 *
 * Used by all provider plugins for credential storage.
 * Replaces duplicated encryption logic from provider-gemini-oauth and mcp-client.
 *
 * Security:
 * - AES-256-GCM authenticated encryption
 * - PBKDF2 key derivation (100,000 iterations, SHA-512)
 * - Machine-binding via hostname + username + saltSuffix
 * - File permissions: chmod 600 (Unix) / icacls (Windows)
 * - Built-in file lock: dual-layer (in-process mutex + cross-process O_EXCL)
 *   ensures safe concurrent access from multiple runners sharing the same
 *   storage directory. No external coordination required.
 */
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
} from "node:crypto";
import { hostname, userInfo } from "node:os";
import { mkdir, readFile, writeFile, unlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "node:child_process";
import { withProcessLock, acquireFileLock } from "./file-lock.js";

// ─── Constants ───

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32; // 256 bits for AES-256
const PBKDF2_DIGEST = "sha512";
const AES_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const SALT_LENGTH = 16;

// ─── Types ───

/** Encrypted payload stored on disk. */
export interface EncryptedPayload {
  iv: string;
  tag: string;
  salt: string;
  data: string;
}

/** Options for SecureStore construction. */
export interface SecureStoreOptions {
  /** Base directory for file storage. */
  basePath: string;
  /** Suffix appended to machine ID for key derivation (default: "openstarry"). */
  saltSuffix?: string;
}

// ─── Helpers ───

function deriveMachineKey(salt: Buffer, saltSuffix: string): Buffer {
  const machineId = `${hostname()}|${userInfo().username}|${saltSuffix}`;
  return pbkdf2Sync(machineId, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
}

function encryptData(plaintext: string, saltSuffix: string): EncryptedPayload {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveMachineKey(salt, saltSuffix);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    salt: salt.toString("hex"),
    data: encrypted.toString("base64"),
  };
}

function decryptData(payload: EncryptedPayload, saltSuffix: string): string {
  const salt = Buffer.from(payload.salt, "hex");
  const key = deriveMachineKey(salt, saltSuffix);
  const iv = Buffer.from(payload.iv, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const encrypted = Buffer.from(payload.data, "base64");

  const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

function isEncryptedPayload(obj: unknown): obj is EncryptedPayload {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.iv === "string" &&
    typeof o.tag === "string" &&
    typeof o.salt === "string" &&
    typeof o.data === "string"
  );
}

async function setFilePermissions(filePath: string): Promise<void> {
  try {
    if (process.platform === "win32") {
      const username = userInfo().username;
      await new Promise<void>((resolve) => {
        exec(
          `icacls "${filePath}" /inheritance:r /grant:r "${username}:(R,W)" /remove "Everyone" /remove "BUILTIN\\Users"`,
          () => resolve(),
        );
      });
    } else {
      await chmod(filePath, 0o600);
    }
  } catch {
    // Permission setting failure is non-blocking
  }
}

// ─── SecureStore Class ───

/**
 * Shared encrypted file storage with built-in file locking.
 *
 * Provides both plain JSON and AES-256-GCM encrypted read/write.
 * All encrypted data is machine-bound via hostname + username.
 *
 * Concurrency: All mutating operations (`write`, `delete`, `writeSecure`,
 * `readSecure`) are protected by a dual-layer lock (in-process async mutex +
 * cross-process O_EXCL lock file). Multiple runners sharing the same storage
 * directory are safe without external coordination.
 */
export class SecureStore {
  private basePath: string;
  private saltSuffix: string;

  constructor(options: SecureStoreOptions) {
    this.basePath = options.basePath;
    this.saltSuffix = options.saltSuffix ?? "openstarry";
  }

  /** Ensure the storage directory exists. */
  async ensureDir(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
  }

  // ─── Dual-layer lock ───

  private async withLock<T>(filename: string, fn: () => Promise<T>): Promise<T> {
    const key = join(this.basePath, filename);
    return withProcessLock(key, async () => {
      const lockPath = key + ".lock";
      await this.ensureDir();
      const release = await acquireFileLock(lockPath);
      try {
        return await fn();
      } finally {
        await release();
      }
    });
  }

  // ─── Internal (no-lock) methods ───

  private async _writeRaw<T>(filename: string, data: T): Promise<void> {
    await this.ensureDir();
    const filePath = join(this.basePath, filename);
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    await setFilePermissions(filePath);
  }

  private async _writeSecureRaw<T>(filename: string, data: T): Promise<void> {
    const plaintext = JSON.stringify(data);
    const encrypted = encryptData(plaintext, this.saltSuffix);
    await this._writeRaw(filename, encrypted);
  }

  private async _deleteRaw(filename: string): Promise<void> {
    try {
      await unlink(join(this.basePath, filename));
    } catch {
      // File may not exist
    }
  }

  // ─── Public API ───

  /** Read a plain JSON file. Returns null if not found or parse fails. No lock needed. */
  async read<T>(filename: string): Promise<T | null> {
    try {
      const content = await readFile(join(this.basePath, filename), "utf-8");
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /** Write a plain JSON file with restrictive permissions. Protected by file lock. */
  async write<T>(filename: string, data: T): Promise<void> {
    await this.withLock(filename, () => this._writeRaw(filename, data));
  }

  /** Delete a file. Silently ignores if not found. Protected by file lock. */
  async delete(filename: string): Promise<void> {
    await this.withLock(filename, () => this._deleteRaw(filename));
  }

  /** Write data encrypted with AES-256-GCM. Protected by file lock. */
  async writeSecure<T>(filename: string, data: T): Promise<void> {
    await this.withLock(filename, () => this._writeSecureRaw(filename, data));
  }

  /**
   * Read encrypted data. Returns null if not found or decryption fails.
   * Handles legacy unencrypted files by auto-migrating to encrypted format.
   * Protected by file lock (may trigger legacy migration write).
   */
  async readSecure<T>(filename: string): Promise<T | null> {
    return this.withLock(filename, async () => {
      const raw = await this.read<EncryptedPayload | T>(filename);
      if (!raw) return null;

      if (isEncryptedPayload(raw)) {
        try {
          const decrypted = decryptData(raw, this.saltSuffix);
          return JSON.parse(decrypted) as T;
        } catch (err) {
          console.warn(
            `[SecureStore] Decryption failed for "${filename}", removing stale file.`,
            err instanceof Error ? err.message : String(err),
          );
          await this._deleteRaw(filename);
          return null;
        }
      }

      // Legacy unencrypted format — re-encrypt and return
      await this._writeSecureRaw(filename, raw);
      return raw as T;
    });
  }
}
