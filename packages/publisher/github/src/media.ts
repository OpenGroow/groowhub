import type { PublisherResult } from "@opengroow/publisher-sdk";

// The article's media, read from the MCP with a plain fetch and no key, at
// commit time (ADR-074): the latest revision is the one published.

const MAX_COVER_BYTES = 20 * 1024 * 1024;

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchMedia(url: string): Promise<PublisherResult<{ response: Response }>> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { ok: false, error: `it responded ${response.status}` };
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

export async function fetchMarkdown(url: string): Promise<PublisherResult<{ text: string }>> {
  const fail = (reason: string) => ({ ok: false as const, error: `Could not fetch the article markdown ${url}: ${reason}` });
  const res = await fetchMedia(url);
  if (!res.ok) return fail(res.error);
  try {
    return { ok: true, text: await res.response.text() };
  } catch (error) {
    return fail(messageOf(error));
  }
}

/** The cover as base64, for a Git blob. "cover not ready" when the MCP cannot serve it (yet). */
export async function fetchCover(url: string): Promise<PublisherResult<{ base64: string }>> {
  const notReady = (reason: string) => ({ ok: false as const, error: `cover not ready (${url}: ${reason})` });
  const res = await fetchMedia(url);
  if (!res.ok) return notReady(res.error);
  const type = (res.response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "" && type !== "image/webp" && type !== "application/octet-stream") {
    return { ok: false, error: `The cover must be a WebP image, ${url} is "${type}"` };
  }
  try {
    const bytes = new Uint8Array(await res.response.arrayBuffer());
    if (bytes.byteLength === 0) return notReady("it is empty");
    if (bytes.byteLength > MAX_COVER_BYTES) return { ok: false, error: `The cover ${url} is too large` };
    return { ok: true, base64: toBase64(bytes) };
  } catch (error) {
    return notReady(messageOf(error));
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
