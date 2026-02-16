/**
 * Guide interface — provides system prompts and persona.
 */

/** A guide that provides the agent's persona and system instructions. */
export interface IGuide {
  id: string;
  name: string;
  getSystemPrompt(): string | Promise<string>;
}
