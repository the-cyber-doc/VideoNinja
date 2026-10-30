import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeIndexedDB } from '../testing/browser';
import { deleteDraft, listDrafts, loadDraft, newDraft, saveDraft, type Draft } from './draft.svelte';

let idb: FakeIndexedDB;
beforeEach(() => {
	idb = new FakeIndexedDB();
	vi.stubGlobal('indexedDB', idb);
});
afterEach(() => vi.unstubAllGlobals());

const file = new File(['abc'], 'kata.mp4');

describe('drafts on this device', () => {
	it('saved, found by the file’s hash, listed newest first, deleted', async () => {
		const first = newDraft('a'.repeat(64), file);
		expect(first).toMatchObject({ originalFilename: 'kata.mp4', size: 3, mode: null, segments: [] });
		await saveDraft(first);
		vi.spyOn(Date, 'now').mockReturnValue(first.savedAt + 1000);
		await saveDraft(newDraft('b'.repeat(64), file));
		expect((await loadDraft('a'.repeat(64)))?.originalFilename).toBe('kata.mp4');
		expect(await loadDraft('c'.repeat(64))).toBeUndefined();
		expect((await listDrafts()).map((d) => d.sha256[0])).toEqual(['b', 'a']);
		await deleteDraft('a'.repeat(64));
		expect((await listDrafts()).map((d) => d.sha256[0])).toEqual(['b']);
		expect([...idb.databases.values()].every((db) => db.closed)).toBe(true);
	});

	it('an earlier version’s draft brought up to date', async () => {
		const old = {
			...newDraft('a'.repeat(64), file),
			originalFilename: '',
			filename: 'old.mov',
			segments: [
				{ key: 1, begin: 1, end: 2, school: 'gyokko', level: 'shoden', technique: 'x', performer: '', tags: [] },
				{
					key: 2,
					begin: 3,
					end: 4,
					school: 'gyokko',
					category: 'taijutsu',
					weapon: '',
					section: 's',
					technique: 's.t',
					performer: '',
					tags: []
				}
			]
		};
		await saveDraft(old as unknown as Draft);
		const draft = (await loadDraft('a'.repeat(64)))!;
		expect(draft.originalFilename).toBe('old.mov');
		expect('filename' in draft).toBe(false);
		expect(draft.segments[0]).toMatchObject({ school: 'gyokko', category: '', weapon: '', section: '', technique: '' });
		expect('level' in draft.segments[0]).toBe(false);
		expect(draft.segments[1]).toMatchObject({ section: 's', technique: 's.t' }); // current already: kept
	});

	it('storage refused: the error, not a hang', async () => {
		idb.failing = true;
		await expect(listDrafts()).rejects.toThrow('storage blocked');
	});

	it('a request refused once the database is open: closed all the same', async () => {
		await saveDraft(newDraft('a'.repeat(64), file));
		idb.failingRequests = true;
		await expect(loadDraft('a'.repeat(64))).rejects.toThrow('storage blocked');
		expect([...idb.databases.values()][0].closed).toBe(true);
	});
});
