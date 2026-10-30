import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { t } from '../i18n.svelte';
import type { Draft } from './draft.svelte';
import { UploadFlow, type FlowDeps } from './flow.svelte';
import type { UploadCallbacks } from './upload';

const LIMITS = { max_bytes: 1000, extensions: ['mp4', 'mkv'] };
const file = (name = 'kata.mp4', size = 10) => new File([new Uint8Array(size)], name);
const draftOf = (sha256: string, f: File): Draft => ({
	sha256,
	originalFilename: f.name,
	size: f.size,
	savedAt: 0,
	mode: 'later',
	allSegmentsDone: false,
	segments: [],
	tags: []
});

/** Fakes for every dependency; `callbacks` holds the upload's, to drive it. */
function fakes(over: Partial<FlowDeps> = {}) {
	const state = {
		callbacks: null as UploadCallbacks | null,
		aborted: [] as (boolean | undefined)[],
		deleted: [] as string[]
	};
	const deps: FlowDeps = {
		sha256File: async (_f, progress) => (progress(1), 'a'.repeat(64)),
		videoExists: async () => false,
		uploadsAvailable: async () => true,
		submit: vi.fn(async () => ({ id: 7 })),
		listDrafts: async () => [],
		loadDraft: async () => undefined,
		newDraft: draftOf,
		deleteDraft: async (sha) => void state.deleted.push(sha),
		startUpload: (_f, _meta, callbacks) => {
			state.callbacks = callbacks;
			return { abort: async (terminate?: boolean) => void state.aborted.push(terminate) };
		},
		...over
	};
	return { deps, state };
}

describe('the upload flow', () => {
	it('refuses a type or a size the server would refuse, before hashing', async () => {
		const sha256File = vi.fn();
		const flow = new UploadFlow(LIMITS, false, fakes({ sha256File }).deps);
		expect(await flow.choose(file('notes.txt'))).toBe(false);
		expect(flow.error).toBe('This type of file is not accepted. Accepted: mp4, mkv.');
		expect(await flow.choose(file('kata.mp4', 2000))).toBe(false);
		expect(String(flow.error)).toMatch(/too large/);
		expect(sha256File).not.toHaveBeenCalled();
		expect(flow.step).toBe('pick');
	});

	it('stops at a video the server has already', async () => {
		const flow = new UploadFlow(LIMITS, false, fakes({ videoExists: async () => true }).deps);
		await flow.choose(file());
		expect([flow.step, flow.duplicate, flow.draft]).toEqual(['pick', true, null]);
	});

	it('resumes the saved draft of the same file', async () => {
		const saved = { ...draftOf('a'.repeat(64), file()), mode: null, allSegmentsDone: true };
		const flow = new UploadFlow(LIMITS, false, fakes({ loadDraft: async () => saved }).deps);
		await flow.choose(file());
		expect([flow.step, flow.resumed]).toEqual(['edit', true]);
		expect(flow.draft?.allSegmentsDone).toBe(true);
		expect(flow.src).toMatch(/^blob:/);
	});

	it('uploads, submits, forgets the draft and says so', async () => {
		const { deps, state } = fakes();
		const flow = new UploadFlow(LIMITS, false, deps);
		await flow.choose(file());
		flow.proceed();
		expect(flow.step).toBe('uploading');
		state.callbacks!.onUrl('/files/abc');
		expect(flow.draft?.uploadUrl).toBe('/files/abc'); // kept in the draft: resumable
		state.callbacks!.onRetry();
		expect(flow.retrying).toBe(true);
		state.callbacks!.onProgress(0.5);
		expect([flow.uploadProgress, flow.retrying]).toEqual([0.5, false]);
		await state.callbacks!.onSuccess('abc');
		expect(deps.submit).toHaveBeenCalledWith('abc', expect.objectContaining({ original_filename: 'kata.mp4' }));
		expect(state.deleted).toEqual(['a'.repeat(64)]);
		expect([flow.step, flow.message, flow.submitted, flow.draft]).toEqual(['pick', t('upload.submitted'), 1, null]);
	});

	it('an upload the server forgot (404) starts over next time', async () => {
		const { deps, state } = fakes();
		const flow = new UploadFlow(LIMITS, false, deps);
		await flow.choose(file());
		flow.draft!.uploadUrl = '/files/old';
		flow.proceed();
		state.callbacks!.onError(new ApiError(404, 'not_found'));
		expect(flow.draft?.uploadUrl).toBeUndefined();
		expect([flow.step, String(flow.error)]).toEqual([
			'edit',
			'The upload failed. Not found. Proceed again to continue where it stopped.'
		]);
	});

	it('cancel deletes what was uploaded and the draft', async () => {
		const { deps, state } = fakes();
		const flow = new UploadFlow(LIMITS, false, deps);
		await flow.choose(file());
		flow.proceed();
		await flow.cancel();
		expect(state.aborted).toEqual([true]); // terminated on the server too
		expect(state.deleted).toEqual(['a'.repeat(64)]);
		expect(flow.step).toBe('pick');
	});

	it('nothing is sent while the server cannot receive uploads', async () => {
		const startUpload = vi.fn();
		const flow = new UploadFlow(LIMITS, true, fakes({ startUpload, uploadsAvailable: async () => false }).deps);
		await flow.choose(file());
		flow.proceed();
		expect(startUpload).not.toHaveBeenCalled();
		expect(flow.step).toBe('edit');
	});
});

describe('the upload flow, edges', () => {
	it('busy while hashing, uploading or submitting', async () => {
		const flow = new UploadFlow(LIMITS, false, fakes().deps);
		expect(flow.busy).toBe(false);
		await flow.choose(file());
		flow.proceed();
		expect(flow.busy).toBe(true);
	});

	it('drafts and availability loaded in the background; their failures ignored', async () => {
		const saved = draftOf('b'.repeat(64), file());
		const flow = new UploadFlow(LIMITS, false, fakes({ listDrafts: async () => [saved] }).deps);
		flow.reloadDrafts();
		flow.checkAvailable();
		await new Promise((resolve) => setTimeout(resolve));
		expect([flow.drafts, flow.unavailable]).toEqual([[saved], false]);
		const failing = new UploadFlow(
			LIMITS,
			false,
			fakes({
				listDrafts: async () => Promise.reject(new Error('blocked')),
				uploadsAvailable: async () => Promise.reject(new Error('offline'))
			}).deps
		);
		failing.reloadDrafts();
		failing.checkAvailable();
		await new Promise((resolve) => setTimeout(resolve));
		expect([failing.drafts, failing.unavailable]).toEqual([[], false]);
	});

	it('a file that cannot be read: back to picking, with the reason', async () => {
		const unreadable = new Error('NotReadableError');
		const flow = new UploadFlow(LIMITS, false, fakes({ sha256File: async () => Promise.reject(unreadable) }).deps);
		await flow.choose(file());
		expect([flow.step, flow.error]).toEqual(['pick', unreadable]);
	});

	it('hashing stopped (another file, cancel): no error shown', async () => {
		let reject!: (e: Error) => void;
		const flow = new UploadFlow(
			LIMITS,
			false,
			fakes({
				sha256File: (_f, _p, signal) =>
					new Promise((_, r) => ((reject = r), signal.addEventListener('abort', () => r(new Error('aborted')))))
			}).deps
		);
		const choosing = flow.choose(file());
		await flow.cancel();
		await choosing;
		expect([flow.step, flow.error]).toEqual(['pick', null]);
		void reject;
	});

	it('a draft that cannot be read: a new one', async () => {
		const flow = new UploadFlow(
			LIMITS,
			false,
			fakes({ loadDraft: async () => Promise.reject(new Error('blocked')) }).deps
		);
		await flow.choose(file());
		expect([flow.step, flow.resumed, flow.draft?.sha256]).toEqual(['edit', false, 'a'.repeat(64)]);
	});

	it('an upload the server deleted (410) starts over; other errors keep the URL', async () => {
		const { deps, state } = fakes();
		const flow = new UploadFlow(LIMITS, false, deps);
		await flow.choose(file());
		flow.draft!.uploadUrl = '/files/old';
		flow.proceed();
		state.callbacks!.onError(new ApiError(503, 'busy'));
		expect(flow.draft?.uploadUrl).toBe('/files/old');
		flow.proceed();
		state.callbacks!.onError(new ApiError(410, 'http_error', { status: 410 }));
		expect(flow.draft?.uploadUrl).toBeUndefined();
	});

	it('a refused submit: back to the annotation, with the reason', async () => {
		const refused = new ApiError(422, 'segment.unknown_technique', { technique: 'x' });
		const { deps, state } = fakes({ submit: vi.fn(async () => Promise.reject(refused)) });
		const flow = new UploadFlow(LIMITS, false, deps);
		await flow.choose(file());
		flow.proceed();
		await state.callbacks!.onSuccess('abc');
		expect([flow.step, flow.error]).toEqual(['edit', refused]);
		expect(state.deleted).toEqual([]); // the draft stays
	});

	it('a saved draft dropped from the list (also when the device refuses)', async () => {
		const saved = [draftOf('b'.repeat(64), file()), draftOf('c'.repeat(64), file())];
		const deps = fakes({
			listDrafts: async () => saved,
			deleteDraft: async () => Promise.reject(new Error('blocked'))
		}).deps;
		const flow = new UploadFlow(LIMITS, false, deps);
		flow.reloadDrafts();
		await new Promise((resolve) => setTimeout(resolve));
		await flow.discard('b'.repeat(64));
		expect(flow.drafts.map((d) => d.sha256[0])).toEqual(['c']);
	});

	it('the page left: the upload paused (resumable), the video released', async () => {
		const { deps, state } = fakes();
		const flow = new UploadFlow(LIMITS, false, deps);
		await flow.choose(file());
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		flow.proceed();
		flow.dispose();
		expect(state.aborted).toEqual([undefined]); // not terminated
		expect(revoke).toHaveBeenCalledWith(flow.src);
		new UploadFlow(LIMITS, false, deps).dispose(); // nothing chosen: nothing to stop
	});
});

describe('the upload flow, when the device or the server refuses to clean up', () => {
	it('submitted all the same; cancelled all the same', async () => {
		const { deps, state } = fakes({
			deleteDraft: async () => Promise.reject(new Error('blocked')),
			startUpload: (_f, _meta, callbacks) => {
				state.callbacks = callbacks;
				return { abort: async () => Promise.reject(new Error('offline')) };
			}
		});
		const flow = new UploadFlow(LIMITS, false, deps);
		await flow.choose(file());
		flow.proceed();
		await state.callbacks!.onSuccess('abc');
		expect([flow.step, flow.submitted]).toEqual(['pick', 1]);
		await flow.choose(file());
		flow.proceed();
		await flow.cancel();
		expect(flow.step).toBe('pick');
	});
});
