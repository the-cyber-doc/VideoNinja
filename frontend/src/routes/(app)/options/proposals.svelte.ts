// The Options page's Proposed entries section: the drafts on screen and their actions (save,
// validate, merge, delete), the busy state and each entry's last error or confirmation. After
// each action the list is read again (a rename moves the entries under it too) and the
// catalogue asked again (its snapshot follows a moment later). Rules: $lib/options/proposals.ts.
import { deleteProposal, editProposal, listProposals, mergeProposal, validateProposal } from '#lib/api/proposals.js';
import type { ProposedEntry } from '#lib/api/types.js';
import { refreshCatalog } from '#lib/catalog.svelte.js';
import { keyOf, problems, toBody, toDraft, type ProposalDraft } from '#lib/options/proposals.js';

export type Done = 'saved' | 'validated' | 'merged' | 'deleted';

export class ProposalOptions {
	entries = $state<ProposedEntry[]>([]);
	drafts = $state<ProposalDraft[]>([]);
	busy = $state(false);
	/** Per draft key: the last error. */
	errors = $state<Record<string, unknown>>({});
	/** The last action done, and on which entry (its key after it). */
	done = $state<{ key: string; what: Done } | null>(null);
	/** Per draft key: the entry to merge it into. */
	into = $state<Record<string, string>>({});

	constructor(entries: ProposedEntry[]) {
		this.#show(entries);
	}

	saved = (draft: ProposalDraft) => this.entries.find((e) => keyOf(e) === draft.key)!;

	save = (draft: ProposalDraft) =>
		this.#run(draft, 'saved', async () => {
			const entry = await editProposal(draft.kind, draft.savedId, toBody(draft));
			return keyOf(entry);
		});

	validate = (draft: ProposalDraft) =>
		this.#run(draft, 'validated', async () => {
			await validateProposal(draft.kind, draft.savedId);
			return draft.key;
		});

	merge = (draft: ProposalDraft) =>
		this.#run(draft, 'merged', async () => {
			await mergeProposal(draft.kind, draft.savedId, this.into[draft.key]);
			return draft.key;
		});

	remove = (draft: ProposalDraft) =>
		this.#run(draft, 'deleted', async () => {
			await deleteProposal(draft.kind, draft.savedId);
			return draft.key;
		});

	/** The server's list: drafts being edited stay as they are while their entry is unchanged. */
	#show(entries: ProposedEntry[]) {
		const kept = new Map(this.drafts.map((d) => [d.key, d]));
		const before = new Map(this.entries.map((e) => [keyOf(e), JSON.stringify(e)]));
		this.entries = entries;
		this.drafts = entries.map((e) => {
			const draft = kept.get(keyOf(e));
			return draft && before.get(keyOf(e)) === JSON.stringify(e) ? draft : toDraft(e);
		});
	}

	async #run(draft: ProposalDraft, what: Done, action: () => Promise<string>): Promise<boolean> {
		if (what === 'saved' && problems(draft).length) return false;
		this.busy = true;
		delete this.errors[draft.key];
		this.done = null;
		try {
			const key = await action();
			this.#show(await listProposals());
			this.done = { key, what };
			refreshCatalog();
			return true;
		} catch (e) {
			this.errors[draft.key] = e;
			return false;
		} finally {
			this.busy = false;
		}
	}
}
