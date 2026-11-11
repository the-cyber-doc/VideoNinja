// The Options page's Proposed entries section: its actions, then the list read again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '#lib/api/client.js';
import type { ProposedEntry } from '#lib/api/types.js';
import { ProposalOptions } from './proposals.svelte';

const mocks = vi.hoisted(() => ({
	listProposals: vi.fn(),
	editProposal: vi.fn(),
	validateProposal: vi.fn(),
	mergeProposal: vi.fn(),
	deleteProposal: vi.fn(),
	refreshCatalog: vi.fn()
}));
vi.mock('#lib/api/proposals.js', () => mocks);
vi.mock('#lib/catalog.svelte.js', async (original) => ({
	...(await original<object>()),
	refreshCatalog: mocks.refreshCatalog
}));

const entry = (more: Partial<ProposedEntry> = {}): ProposedEntry => ({
	kind: 'technique',
	id: 'gyokko.taijutsu.jo_ryaku.kote',
	name: 'kote',
	kanji: '',
	romaji: 'Kote',
	ryu: null,
	category: null,
	weapon: null,
	section: 'gyokko.taijutsu.jo_ryaku',
	descriptions: { en: '', fr: '' },
	used: 1,
	children: 0,
	proposed_by: 'Aiko',
	proposed_at: '2026-11-10T10:00:00+01:00',
	...more
});

afterEach(() => vi.resetAllMocks());

const KOTE = entry();
const URA = entry({ id: 'gyokko.taijutsu.jo_ryaku.ura', name: 'ura', romaji: 'Ura', used: 0 });

describe('the proposed entries of the Options page', () => {
	it('saved under its new ID: the list read again, the catalogue asked again', async () => {
		const options = new ProposalOptions([KOTE, URA]);
		const [kote, ura] = options.drafts;
		ura.kanji = '裏'; // being edited: kept while its entry is unchanged
		kote.name = 'kote_gaeshi';
		const renamed = { ...KOTE, id: 'gyokko.taijutsu.jo_ryaku.kote_gaeshi', name: 'kote_gaeshi' };
		mocks.editProposal.mockResolvedValue(renamed);
		mocks.listProposals.mockResolvedValue([renamed, URA]);
		expect(await options.save(kote)).toBe(true);
		expect(mocks.editProposal).toHaveBeenCalledWith(
			'technique',
			KOTE.id,
			expect.objectContaining({ name: 'kote_gaeshi' })
		);
		expect(options.drafts.map((d) => d.savedId)).toEqual([renamed.id, URA.id]);
		expect(options.drafts[1].kanji).toBe('裏');
		expect(options.done).toEqual({ key: `technique:${renamed.id}`, what: 'saved' });
		expect(options.saved(options.drafts[0])).toEqual(renamed);
		expect(mocks.refreshCatalog).toHaveBeenCalled();
		expect(options.busy).toBe(false);
	});

	it('a draft with problems: nothing sent', async () => {
		const options = new ProposalOptions([KOTE]);
		options.drafts[0].romaji = '';
		expect(await options.save(options.drafts[0])).toBe(false);
		expect(mocks.editProposal).not.toHaveBeenCalled();
	});

	it('validated, merged, deleted: gone from the list; a refusal said on the entry', async () => {
		const options = new ProposalOptions([KOTE, URA]);
		const [kote, ura] = options.drafts;
		mocks.listProposals.mockResolvedValue([URA]);
		expect(await options.validate(kote)).toBe(true);
		expect(mocks.validateProposal).toHaveBeenCalledWith('technique', KOTE.id);
		expect(options.done).toEqual({ key: kote.key, what: 'validated' });

		options.into[ura.key] = 'gyokko.taijutsu.jo_ryaku.koku';
		mocks.listProposals.mockResolvedValue([]);
		expect(await options.merge(ura)).toBe(true);
		expect(mocks.mergeProposal).toHaveBeenCalledWith('technique', URA.id, 'gyokko.taijutsu.jo_ryaku.koku');

		const refused = new ApiError(409, 'catalog.in_use', { id: URA.id, count: 2 });
		mocks.deleteProposal.mockRejectedValue(refused);
		expect(await options.remove(ura)).toBe(false);
		expect(options.errors[ura.key]).toBe(refused);
		mocks.deleteProposal.mockResolvedValue(undefined);
		expect(await options.remove(ura)).toBe(true);
		expect(options.errors[ura.key]).toBeUndefined();
		expect(options.done?.what).toBe('deleted');
	});
});
