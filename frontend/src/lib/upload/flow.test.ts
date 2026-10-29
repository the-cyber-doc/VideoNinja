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
	const state = { callbacks: null as UploadCallbacks | null, aborted: [] as (boolean | undefined)[], deleted: [] as string[] };
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
		expect([flow.step, String(flow.error)]).toEqual(['edit', 'The upload failed. Not found. Proceed again to continue where it stopped.']);
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
