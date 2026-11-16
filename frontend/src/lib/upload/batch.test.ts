import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { i18n } from '../i18n.svelte';
import { BatchImport, sizeText, type BatchDeps } from './batch.svelte';
import type { UploadCallbacks } from './upload';

const LIMITS = { max_bytes: 1000, extensions: ['mp4', 'mkv'], book_max_bytes: 100 };
const file = (name = 'kata.mp4', size = 10, lastModified = 1) =>
	new File([new Uint8Array(size)], name, { lastModified });
const tick = () => new Promise((resolve) => setTimeout(resolve));

/** Fakes for every dependency. Uploads end at once (`auto`) unless told otherwise; `uploads` holds
 * each one's callbacks and metadata, to drive them. */
function fakes(over: Partial<BatchDeps> = {}, auto: ((c: UploadCallbacks) => void) | null = (c) => c.onSuccess('t')) {
	const state = {
		uploads: [] as { meta: { sha256: string; originalFilename: string; uploadUrl?: string }; c: UploadCallbacks }[],
		aborted: [] as (boolean | undefined)[]
	};
	const deps: BatchDeps = {
		sha256File: async (f, progress) => (progress(1), `sha-${f.name}`),
		videoExists: async () => false,
		uploadsAvailable: async () => true,
		submit: vi.fn(async () => ({ id: 7 })),
		startUpload: (_f, meta, c) => {
			state.uploads.push({ meta, c });
			c.onUrl(`/files/${meta.originalFilename}`);
			c.onProgress(0.5);
			if (auto) auto(c);
			return {
				abort: async (terminate?: boolean) => {
					state.aborted.push(terminate);
					throw new Error('already ended'); // ignored
				}
			};
		},
		...over
	};
	return { deps, state };
}

describe('the mass import', () => {
	it('adds files over several picks, each one once, and refuses at once what the server would', () => {
		const batch = new BatchImport(LIMITS, false, fakes().deps);
		batch.add([file('a.mp4'), file('b.mkv')]);
		batch.add([file('a.mp4'), file('c.mp4'), file('notes.txt'), file('big.mp4', 2000)]);
		batch.add([file('a.mp4', 10, 2)]); // another file with the same name
		expect(batch.items.map((i) => [i.file.name, i.status])).toEqual([
			['a.mp4', 'waiting'],
			['b.mkv', 'waiting'],
			['c.mp4', 'waiting'],
			['notes.txt', 'refused'],
			['big.mp4', 'refused'],
			['a.mp4', 'waiting']
		]);
		expect(batch.items[3].error).toBe('This type of file is not accepted. Accepted: mp4, mkv.');
		expect(String(batch.items[4].error)).toMatch(/too large/);
		expect([batch.pending, batch.finished]).toEqual([4, 2]);
	});

	it('takes any file when the limits are not known', () => {
		const batch = new BatchImport(null, false, fakes().deps);
		batch.add([file('notes.txt')]);
		expect(batch.items[0].status).toBe('waiting');
	});

	it('uploads and queues each file in turn, with the same tags and no segments', async () => {
		const { deps, state } = fakes();
		const batch = new BatchImport(LIMITS, false, deps);
		batch.add([file('a.mp4'), file('b.mp4')]);
		batch.tags = [{ id: 'year', value: '2024' }, { id: 'rain' }];
		await batch.process();
		expect(state.uploads.map((u) => u.meta)).toEqual([
			{ sha256: 'sha-a.mp4', originalFilename: 'a.mp4', uploadUrl: undefined },
			{ sha256: 'sha-b.mp4', originalFilename: 'b.mp4', uploadUrl: undefined }
		]);
		const body = (name: string) => ({
			original_filename: name,
			all_segments_done: false,
			segments: [],
			tags: [{ id: 'year', value: '2024' }, { id: 'rain' }]
		});
		expect(deps.submit).toHaveBeenNthCalledWith(1, 't', body('a.mp4'));
		expect(deps.submit).toHaveBeenNthCalledWith(2, 't', body('b.mp4'));
		expect(batch.items.map((i) => i.status)).toEqual(['done', 'done']);
		expect([batch.queued, batch.submitted, batch.running, batch.current]).toEqual([2, 2, false, null]);
		expect([batch.pending, batch.finished]).toEqual([0, 2]);
	});

	it('skips a video the server has already, and one sent meanwhile', async () => {
		const submit = vi.fn(async () => {
			throw new ApiError(409, 'video.exists');
		});
		const { deps, state } = fakes({ videoExists: async (sha) => sha === 'sha-a.mp4', submit });
		const batch = new BatchImport(LIMITS, false, deps);
		batch.add([file('a.mp4'), file('b.mp4')]);
		await batch.process();
		expect(batch.items.map((i) => [i.status, i.error])).toEqual([
			['duplicate', null],
			['duplicate', null]
		]);
		expect(state.uploads).toHaveLength(1);
		expect(batch.queued).toBe(0);
	});

	it('goes on after a failure, which the next Process retries where it stopped', async () => {
		let started = 0; // the first upload fails
		const { deps, state } = fakes({}, (c) => (started++ ? c.onSuccess('t') : c.onError(new ApiError(500, 'internal'))));
		const submit = deps.submit as ReturnType<typeof vi.fn>;
		submit.mockRejectedValueOnce(new ApiError(422, 'tag.unknown', { tag: 'x' })); // the second's submit
		const batch = new BatchImport(LIMITS, false, deps);
		batch.add([file('a.mp4'), file('b.mp4')]);
		await batch.process();
		expect(batch.items.map((i) => i.status)).toEqual(['failed', 'failed']);
		expect(String(batch.items[0].error)).toMatch(/^The upload failed\. .* Process again/);
		expect(batch.items[1].error).toBeInstanceOf(ApiError); // its submit refused
		expect(batch.items[0].uploadUrl).toBe('/files/a.mp4'); // kept: resumed

		const hashes = vi.spyOn(deps, 'sha256File');
		await batch.process();
		expect(batch.items.map((i) => [i.status, i.error])).toEqual([
			['done', null],
			['done', null]
		]);
		expect(state.uploads.slice(2).map((u) => u.meta.uploadUrl)).toEqual(['/files/a.mp4', '/files/b.mp4']);
		expect(hashes).not.toHaveBeenCalled(); // hashed once
	});

	it('forgets an upload the server forgot (404, 410), and says when tusd retries', async () => {
		const { deps, state } = fakes({}, null);
		const batch = new BatchImport(LIMITS, false, deps);
		batch.add([file('a.mp4')]);
		const run = batch.process();
		await tick();
		state.uploads[0].c.onRetry();
		expect(batch.items[0].retrying).toBe(true);
		state.uploads[0].c.onProgress(0.7);
		expect([batch.items[0].retrying, batch.items[0].progress]).toEqual([false, 0.7]);
		state.uploads[0].c.onRetry();
		state.uploads[0].c.onError(new ApiError(410, 'gone'));
		await run;
		expect([batch.items[0].status, batch.items[0].uploadUrl, batch.items[0].retrying]).toEqual([
			'failed',
			undefined,
			false
		]);
	});

	it('refuses to start while the server cannot receive uploads', async () => {
		const { deps, state } = fakes({ uploadsAvailable: async () => false });
		const batch = new BatchImport(LIMITS, false, deps);
		batch.add([file()]);
		await batch.process();
		expect(batch.error).toMatch(/not possible right now/);
		expect([batch.unavailable, batch.running, state.uploads.length]).toEqual([true, false, 0]);
		// Not known: tried anyway.
		deps.uploadsAvailable = async () => Promise.reject(new Error('offline'));
		await batch.process();
		expect([batch.unavailable, batch.error, batch.items[0].status]).toEqual([false, null, 'done']);
	});

	it('starts once, and takes the files added while it runs', async () => {
		const { deps, state } = fakes({}, null);
		const batch = new BatchImport(LIMITS, true, deps);
		expect(batch.unavailable).toBe(true);
		batch.add([file('a.mp4')]);
		const run = batch.process();
		await batch.process(); // already running: nothing
		await tick();
		expect(batch.current).toBe(batch.items[0].key);
		batch.add([file('b.mp4')]);
		state.uploads[0].c.onSuccess('t1');
		await tick();
		state.uploads[1].c.onSuccess('t2');
		await run;
		expect(batch.items.map((i) => i.status)).toEqual(['done', 'done']);
		expect(state.uploads).toHaveLength(2);
	});

	it('stops: the upload aborted but kept, the file waiting again, the others not started', async () => {
		const { deps, state } = fakes({}, null);
		const batch = new BatchImport(LIMITS, false, deps);
		batch.add([file('a.mp4'), file('b.mp4')]);
		const run = batch.process();
		await tick();
		expect(batch.items[0].status).toBe('uploading');
		batch.stop();
		await run;
		expect(state.aborted).toEqual([undefined]); // not terminated: resumed next time
		expect(batch.items.map((i) => [i.status, i.progress, i.error])).toEqual([
			['waiting', 0, null],
			['waiting', 0, null]
		]);
		expect(batch.running).toBe(false);
	});

	it('stops while hashing, and when the page is left', async () => {
		const sha256File = (_f: File, _p: (f: number) => void, signal: AbortSignal) =>
			new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
		const batch = new BatchImport(LIMITS, false, fakes({ sha256File }).deps);
		batch.add([file()]);
		const run = batch.process();
		await tick();
		expect(batch.items[0].status).toBe('hashing');
		batch.dispose();
		await run;
		expect(batch.items[0].status).toBe('waiting');
		batch.dispose(); // nothing running: nothing to do
	});

	it('stops between the duplicate check and the upload', async () => {
		let stop = () => {};
		const { deps, state } = fakes({ videoExists: async () => (stop(), false) });
		const batch = new BatchImport(LIMITS, false, deps);
		stop = () => batch.stop();
		batch.add([file()]);
		await batch.process();
		expect([batch.items[0].status, state.uploads.length]).toEqual(['waiting', 0]);
	});

	it('removes a file, never the one being sent, and the finished ones', async () => {
		const { deps, state } = fakes({ videoExists: async (sha) => sha === 'sha-dup.mp4' }, null);
		const batch = new BatchImport(LIMITS, false, deps);
		batch.add([file('a.mp4'), file('b.mp4'), file('dup.mp4'), file('notes.txt')]);
		const [a, b] = batch.items.map((i) => i.key);
		const run = batch.process();
		await tick();
		batch.remove(a); // being sent: kept
		batch.remove(b);
		expect(batch.items.map((i) => i.file.name)).toEqual(['a.mp4', 'dup.mp4', 'notes.txt']);
		state.uploads[0].c.onSuccess('t');
		await run;
		expect(batch.items.map((i) => i.status)).toEqual(['done', 'duplicate', 'refused']);
		batch.add([file('c.mp4')]);
		batch.removeFinished();
		expect(batch.items.map((i) => i.file.name)).toEqual(['c.mp4']);
	});

	it("shows sizes in the page's language", () => {
		expect(sizeText(5.5 * 1024 ** 2)).toBe('5.5 MB');
		expect(sizeText(2 * 1024 ** 3)).toBe('2 GB');
		i18n.lang = 'fr';
		expect(sizeText(1.25 * 1024 ** 2)).toBe('1,3\u202fMo'); // a narrow no-break space
		i18n.lang = 'en';
	});
});
