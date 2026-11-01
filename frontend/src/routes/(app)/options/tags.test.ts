import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '#lib/api/client.js';
import type { TagDefinition } from '#lib/api/types.js';
import { TagOptions } from './tags.svelte';

const mocks = vi.hoisted(() => ({ createTag: vi.fn(), saveTag: vi.fn(), deleteTag: vi.fn() }));
vi.mock('#lib/api/tags.js', () => mocks);

const PLACE: TagDefinition = {
	id: 'place',
	names: { en: 'Place', fr: 'Lieu' },
	format: 'list',
	regexp: null,
	hint: null,
	input_mode: 'text',
	min: null,
	max: null,
	values: [{ id: 'dojo', names: { en: 'Dojo', fr: 'Dojo' }, used: 1 }],
	used: 1
};

afterEach(() => vi.resetAllMocks());

describe('the tags of the Options page', () => {
	it('a new tag: on top, created, then saved under its ID', async () => {
		const options = new TagOptions([PLACE]);
		const draft = options.add();
		expect(options.drafts.map((d) => d.savedId)).toEqual([null, 'place']);
		expect(await options.save(draft)).toBe(false); // problems: nothing sent
		expect(mocks.createTag).not.toHaveBeenCalled();

		Object.assign(draft, { id: 'rain', names: { en: 'Rain', fr: 'Pluie' }, format: 'none' });
		mocks.createTag.mockResolvedValue({ ...PLACE, id: 'rain', format: null, values: [], used: 0 });
		expect(await options.save(draft)).toBe(true);
		expect(mocks.createTag).toHaveBeenCalledWith(expect.objectContaining({ id: 'rain', format: null }));
		expect(options.drafts[0]).toMatchObject({ key: draft.key, savedId: 'rain' });
		expect(options.saved[draft.key]).toBe(true);
		expect(options.busy).toBe(false);
	});

	it('saved under its old ID (a rename), values added and removed', async () => {
		const options = new TagOptions([PLACE]);
		const draft = options.drafts[0];
		draft.id = 'venue';
		options.addValue(draft);
		Object.assign(draft.values[1], { id: 'hall', names: { en: 'Hall', fr: 'Salle' } });
		mocks.saveTag.mockResolvedValue({ ...PLACE, id: 'venue' });
		await options.save(draft);
		expect(mocks.saveTag).toHaveBeenCalledWith(
			'place',
			expect.objectContaining({
				id: 'venue',
				values: [
					{ id: 'dojo', previous_id: 'dojo', names: { en: 'Dojo', fr: 'Dojo' } },
					{ id: 'hall', previous_id: null, names: { en: 'Hall', fr: 'Salle' } }
				]
			})
		);
		options.removeValue(options.drafts[0], options.drafts[0].values[0]);
		expect(options.drafts[0].values).toEqual([]);
	});

	it('a refusal kept for its tag; discard goes back to the server, or drops a new one', async () => {
		const options = new TagOptions([PLACE]);
		const draft = options.drafts[0];
		draft.names.en = 'Changed';
		const refused = new ApiError(409, 'tag.value_in_use', { tag: 'place', value: 'dojo', count: 1 });
		mocks.saveTag.mockRejectedValue(refused);
		expect(await options.save(draft)).toBe(false);
		expect(options.errors[draft.key]).toBe(refused);

		options.discard(draft);
		expect(options.drafts[0]).toMatchObject({ key: draft.key, names: { en: 'Place' } });
		expect(options.errors[draft.key]).toBeUndefined();

		const added = options.add();
		options.discard(added);
		expect(options.drafts.map((d) => d.savedId)).toEqual(['place']);
	});

	it('delete: on the server unless never saved', async () => {
		const options = new TagOptions([PLACE]);
		options.add();
		await options.remove(options.drafts[0]);
		expect(mocks.deleteTag).not.toHaveBeenCalled();
		await options.remove(options.drafts[0]);
		expect(mocks.deleteTag).toHaveBeenCalledWith('place');
		expect(options.drafts).toEqual([]);
	});
});
