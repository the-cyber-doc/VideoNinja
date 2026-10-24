// The upload page's work in progress, saved on this device (IndexedDB) so it
// can be resumed after leaving the page. Keyed by the original file's SHA-256:
// picking the same file again finds it. Deleted on logout ($lib/pwa.ts).
import { UPLOAD_DB } from '../pwa-caches';
import type { TagValue } from './api';

/** "Define segments later", "This video does not contain any technique segment", or neither. */
export type Mode = 'later' | 'none' | null;

export interface DraftSegment {
	/** Stable key for the page (not sent). */
	key: number;
	/** The server's segment ID, when annotating a published video again. */
	id?: number;
	/** Who created it (display name), from the server; null: user unknown. Shown, never sent.
	 * Not set: a new segment, the current user's. */
	createdBy?: string | null;
	/** Seconds, frame-accurate on the page; rounded to whole seconds when sent. */
	begin: number;
	end: number;
	school: string;
	level: string;
	technique: string;
	performer: string;
	tags: TagValue[];
}

/** What the annotation panel edits: at upload, or later for a published video. */
export interface Annotation {
	mode: Mode;
	/** The checkbox, when no mode forces it. */
	allSegmentsDone: boolean;
	segments: DraftSegment[];
	tags: TagValue[];
}

export interface Draft extends Annotation {
	sha256: string;
	/** The file's name on the device (stored as video.original_filename). */
	originalFilename: string;
	size: number;
	savedAt: number;
	/** tus upload URL, to resume an interrupted upload. */
	uploadUrl?: string;
}

const STORE = 'drafts';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(UPLOAD_DB, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'sha256' });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await open();
	try {
		return await new Promise<T>((resolve, reject) => {
			const request = action(db.transaction(STORE, mode).objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

/** Drafts saved before the rename filename → originalFilename keep their name. */
function upgrade(draft: Draft & { filename?: string }): Draft {
	if (!draft.originalFilename && draft.filename) draft.originalFilename = draft.filename;
	delete draft.filename;
	return draft;
}

export const loadDraft = async (sha256: string) => {
	const draft = await run<Draft | undefined>('readonly', (s) => s.get(sha256));
	return draft && upgrade(draft);
};

/** Saved copy: Svelte state proxies cannot be stored as they are. */
export const saveDraft = (draft: Draft) =>
	run('readwrite', (s) => s.put({ ...$state.snapshot(draft), savedAt: Date.now() }));

export const deleteDraft = (sha256: string) => run('readwrite', (s) => s.delete(sha256));

/** Newest first. */
export const listDrafts = async () =>
	(await run<Draft[]>('readonly', (s) => s.getAll())).map(upgrade).sort((a, b) => b.savedAt - a.savedAt);

export function newDraft(sha256: string, file: File): Draft {
	return {
		sha256,
		originalFilename: file.name,
		size: file.size,
		savedAt: Date.now(),
		mode: null,
		allSegmentsDone: false,
		segments: [],
		tags: []
	};
}
