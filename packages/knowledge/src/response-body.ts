import type { KnowledgeFetchResponse } from "./schemas.js";

/**
 * The largest remote document that a knowledge workflow will retain in memory.
 * The cap is enforced while reading, not after `Response.text()` has already
 * buffered an unbounded response.
 */
export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 2 * 1024 * 1024;

export class KnowledgeDocumentTooLargeError extends Error {
  readonly bytesRead: number;
  readonly limit: number;

  constructor(bytesRead: number, limit: number) {
    super(`Response body exceeded the ${limit} byte knowledge document limit.`);
    this.name = "KnowledgeDocumentTooLargeError";
    this.bytesRead = bytesRead;
    this.limit = limit;
  }
}

export interface BoundedResponseBody {
  readonly text: string;
  readonly bytes: number;
}

/**
 * Read a fetch body with a byte limit before materializing it as text. The
 * response contract deliberately exposes the stream rather than `text()` so
 * callers cannot accidentally buffer an unbounded remote document first.
 */
export async function readKnowledgeResponseBody(
  response: KnowledgeFetchResponse,
  limit = MAX_KNOWLEDGE_DOCUMENT_BYTES,
): Promise<BoundedResponseBody> {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError("Knowledge document byte limit must be a non-negative safe integer.");
  }
  if (response.body === null) {
    return { text: "", bytes: 0 };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      bytes += value.byteLength;
      if (bytes > limit) {
        // Stop the network stream immediately. Ignore a cancellation failure:
        // the security outcome is still a rejected document, never a fallback
        // to reading it in full.
        try {
          await reader.cancel();
        } catch {
          // The response is rejected below even if its stream cannot cancel.
        }
        throw new KnowledgeDocumentTooLargeError(bytes, limit);
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { text: parts.join(""), bytes };
  } finally {
    reader.releaseLock();
  }
}
