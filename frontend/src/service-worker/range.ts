// Range requests answered from a cached clip. <video> asks for byte ranges
// (seeking; Safari plays nothing without 206 answers), but the Cache API only
// returns whole responses: cut the asked part out of the stored file.

/** The part of `cached` (a whole 200 response) asked for by `range`, as the server would send it. */
export async function rangeResponse(cached: Response, range: string | null): Promise<Response> {
	if (!range) return cached;
	const blob = await cached.blob(); // a Blob: slicing does not copy the clip into memory
	const size = blob.size;
	const type = cached.headers.get('Content-Type') ?? 'application/octet-stream';
	const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim()); // one range: what browsers send for media
	let start = NaN;
	let end = NaN;
	if (match && match[1] !== '') {
		start = Number(match[1]);
		end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
	} else if (match && match[2] !== '') {
		start = Math.max(size - Number(match[2]), 0); // the last N bytes
		end = size - 1;
	}
	if (!(start <= end && start < size)) {
		return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
	}
	return new Response(blob.slice(start, end + 1), {
		status: 206,
		headers: {
			'Content-Type': type,
			'Content-Range': `bytes ${start}-${end}/${size}`,
			'Content-Length': String(end - start + 1),
			'Accept-Ranges': 'bytes'
		}
	});
}
