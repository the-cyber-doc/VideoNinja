// Resumable upload of the original file to tusd (/files/, behind nginx), in
// 50 MB chunks. The upload URL is kept in the draft: after leaving the page,
// picking the same file again continues where it stopped.
import { Upload } from 'tus-js-client';
import { ApiError, errorFromBody } from '../api';
import { url } from '../base';

export const CHUNK_SIZE = 50 * 1024 * 1024; // nginx: client_max_body_size 64m on /files/

export interface UploadCallbacks {
	/** The upload URL is known: save it to resume later. */
	onUrl: (url: string) => void;
	onProgress: (fraction: number) => void;
	/** Done: the tus ID (last part of the URL), for the submit call. */
	onSuccess: (tusId: string) => void;
	/** A request failed and is retried (connection lost, server down): tell the user. */
	onRetry: () => void;
	/** Given up: the server's error (its code translated), or 'network' without an answer. */
	onError: (error: ApiError) => void;
}

interface TusResponse {
	getStatus(): number;
	getBody(): string;
	getHeader(name: string): string | undefined;
}

/** tus-js-client's error as the API's: the answer's JSON (from the app's hooks:
 * {code, detail, params}) or its status (nginx's own pages), else no answer. */
export function uploadError(e: Error): ApiError {
	const response = (e as { originalResponse?: TusResponse | null }).originalResponse;
	if (!response) return new ApiError(0, 'network');
	let body: unknown = null;
	try {
		body = JSON.parse(response.getBody());
	} catch {
		// not JSON: the status alone
	}
	return errorFromBody(response.getStatus(), body, response.getHeader('X-Request-ID') ?? null);
}

export function startUpload(
	file: File,
	meta: { sha256: string; originalFilename: string; uploadUrl?: string },
	callbacks: UploadCallbacks
): Upload {
	const upload: Upload = new Upload(file, {
		endpoint: url('/files/'),
		uploadUrl: meta.uploadUrl ?? null,
		chunkSize: CHUNK_SIZE,
		retryDelays: [0, 3000, 10000, 30000, 60000],
		// "filename": the tus metadata convention; the server stores it as video.original_filename.
		metadata: { filename: meta.originalFilename, original_sha256: meta.sha256 },
		storeFingerprintForResuming: false, // the URL is kept in the draft instead
		onUploadUrlAvailable: () => upload.url && callbacks.onUrl(upload.url),
		onProgress: (sent, total) => callbacks.onProgress(total ? sent / total : 0),
		// As tus-js-client's default (no retry on a client error, except 409/423),
		// but the page is told, instead of retrying silently for minutes.
		onShouldRetry: (error) => {
			const status = (error as { originalResponse?: { getStatus(): number } }).originalResponse?.getStatus() ?? 0;
			const retry = !(status >= 400 && status < 500 && status !== 409 && status !== 423);
			if (retry) callbacks.onRetry();
			return retry;
		},
		onSuccess: () => callbacks.onSuccess(new URL(upload.url!, location.href).pathname.split('/').pop()!),
		onError: (e) => callbacks.onError(uploadError(e))
	});
	upload.start();
	return upload;
}
