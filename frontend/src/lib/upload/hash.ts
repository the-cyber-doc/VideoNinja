// SHA-256 of a (possibly huge) local file, read in chunks: the Web Crypto API
// only hashes a whole buffer at once. hash-wasm streams and is fast (WebAssembly).
import { createSHA256 } from 'hash-wasm';

const CHUNK = 8 * 1024 * 1024;

export async function sha256File(
	file: Blob,
	onProgress: (fraction: number) => void = () => {},
	signal?: AbortSignal
): Promise<string> {
	const hasher = await createSHA256();
	hasher.init();
	for (let offset = 0; offset < file.size; offset += CHUNK) {
		signal?.throwIfAborted();
		const chunk = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
		hasher.update(chunk);
		onProgress(Math.min(1, (offset + chunk.length) / file.size));
	}
	onProgress(1);
	return hasher.digest('hex');
}
