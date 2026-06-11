/**
 * Quick test: read OAuth token and call Gemini API directly.
 */
import { SecureStore } from "../packages/shared/dist/index.js";
import { join } from "path";
import { homedir } from "os";

const dir = join(homedir(), ".openstarry", "plugins", "gemini-oauth");
const store = new SecureStore({ basePath: dir, saltSuffix: "openstarry-gemini-oauth" });

const token = await store.readSecure("oauth_token.json");
if (!token?.accessToken) {
  console.log("No OAuth token found. Login first.");
  process.exit(1);
}

console.log("Token found, expires:", token.expiresAt ? new Date(token.expiresAt).toISOString() : "unknown");
console.log("Scopes:", token.scope ?? "not stored");

// Test 1: non-streaming generateContent
console.log("\n--- Test: generateContent ---");
const resp = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Say hello in one word" }] }],
    }),
  },
);
console.log("Status:", resp.status);
const text = await resp.text();
console.log("Response:", text.slice(0, 500));

process.exit(0);
