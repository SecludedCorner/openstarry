/**
 * UUID v4 generation using Node.js crypto.
 */

import { randomUUID } from "node:crypto";

export function generateId(): string {
  return randomUUID();
}
