/**
 * SHA-256 hash using Web Crypto API (CF Workers compatible)
 */
export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const buffer = typeof data === "string" ? encoder.encode(data) : data;
  // Create a new ArrayBuffer to ensure compatibility with crypto.subtle.digest
  const arrayBuffer = new ArrayBuffer(buffer.length);
  new Uint8Array(arrayBuffer).set(buffer);
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return new Uint8Array(hashBuffer);
}

/**
 * SHA-256 hash as hex string
 */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const hash = await sha256(data);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SHA-256 hash as base64 string
 */
export async function sha256Base64(data: Uint8Array | string): Promise<string> {
  const hash = await sha256(data);
  return btoa(String.fromCharCode(...hash));
}
