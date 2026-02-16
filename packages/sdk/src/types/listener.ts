/**
 * Listener interface — receives external input (受蘊).
 */

/** A listener that receives external input (e.g., CLI stdin, WebSocket, HTTP). */
export interface IListener {
  id: string;
  name: string;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
