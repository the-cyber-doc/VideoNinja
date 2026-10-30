import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE, startUpload, uploadError, type UploadCallbacks } from './upload';

// tus-js-client's Upload, recorded: the test calls its options' callbacks itself.
const uploads: { file: File; options: Record<string, unknown>; started: boolean; url: string | null }[] = [];
vi.mock('tus-js-client', () => ({
	Upload: class {
		url: string | null = null;
		constructor(
			public file: File,
			public options: Record<string, unknown>
		) {
			uploads.push(this as never);
		}
		start() {
			(this as unknown as { started: boolean }).started = true;
		}
	}
}));

const answer = (status: number, body: string, requestId?: string) => ({
	originalResponse: {
		getStatus: () => status,
		getBody: () => body,
		getHeader: (name: string) => (name === 'X-Request-ID' ? requestId : undefined)
	}
});

/** Call one of the options' callbacks, as tus-js-client would. */
const on = (upload: (typeof uploads)[number], name: string, ...args: unknown[]) =>
	(upload.options[name] as (...args: unknown[]) => unknown)(...args);

afterEach(() => {
	uploads.length = 0;
	vi.unstubAllGlobals();
});

describe('upload errors', () => {
	it('the hook’s coded answer, with its request ID', () => {
		const e = uploadError(Object.assign(new Error(), answer(413, '{"code":"upload.too_large","params":{}}', 'rid')));
		expect([e.status, e.code, e.requestId]).toEqual([413, 'upload.too_large', 'rid']);
	});

	it('nginx’s page (not JSON): by its status', () => {
		expect(uploadError(Object.assign(new Error(), answer(429, '<html>'))).code).toBe('rate_limited');
	});

	it('no answer at all', () => {
		expect(uploadError(new Error('offline')).code).toBe('network');
	});
});

describe('startUpload', () => {
	function start(uploadUrl?: string) {
		const callbacks: UploadCallbacks = {
			onUrl: vi.fn(),
			onProgress: vi.fn(),
			onSuccess: vi.fn(),
			onRetry: vi.fn(),
			onError: vi.fn()
		};
		const file = new File(['x'], 'kata.mp4');
		const upload = startUpload(file, { sha256: 'abc', originalFilename: 'kata.mp4', uploadUrl }, callbacks);
		return { upload: uploads.at(-1)!, callbacks, returned: upload };
	}

	it('to /files/, resumed from the draft’s URL, in chunks, with the hash and the name', () => {
		const { upload } = start('/files/old');
		expect(upload.started).toBe(true);
		expect(upload.options).toMatchObject({
			endpoint: '/files/',
			uploadUrl: '/files/old',
			chunkSize: CHUNK_SIZE,
			metadata: { filename: 'kata.mp4', original_sha256: 'abc' },
			storeFingerprintForResuming: false
		});
		expect(start().upload.options.uploadUrl).toBeNull();
	});

	it('reports its URL, progress, success (the tus ID) and errors', () => {
		vi.stubGlobal('location', new URL('https://app.test/upload'));
		const { upload, callbacks } = start();
		on(upload, 'onUploadUrlAvailable');
		expect(callbacks.onUrl).not.toHaveBeenCalled(); // no URL yet
		upload.url = 'https://app.test/files/abc123';
		on(upload, 'onUploadUrlAvailable');
		expect(callbacks.onUrl).toHaveBeenCalledWith('https://app.test/files/abc123');
		on(upload, 'onProgress', 5, 10);
		on(upload, 'onProgress', 0, 0);
		expect(callbacks.onProgress).toHaveBeenNthCalledWith(1, 0.5);
		expect(callbacks.onProgress).toHaveBeenNthCalledWith(2, 0);
		on(upload, 'onSuccess');
		expect(callbacks.onSuccess).toHaveBeenCalledWith('abc123');
		on(upload, 'onError', new Error('offline'));
		expect((callbacks.onError as ReturnType<typeof vi.fn>).mock.calls[0][0].code).toBe('network');
	});

	it.each([
		[0, true], // no answer: connection lost
		[500, true],
		[409, true], // offset mismatch: tus asks again
		[423, true],
		[403, false],
		[413, false]
	])('retry after status %i: %s, and the page told', (status, retry) => {
		const { upload, callbacks } = start();
		const error = status ? Object.assign(new Error(), answer(status, '')) : new Error();
		expect(on(upload, 'onShouldRetry', error)).toBe(retry);
		expect(callbacks.onRetry).toHaveBeenCalledTimes(retry ? 1 : 0);
	});
});
