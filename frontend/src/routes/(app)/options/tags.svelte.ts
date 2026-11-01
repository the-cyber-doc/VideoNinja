// The Options page's Tags section: the drafts on screen and their actions (add, save,
// delete, a value added or removed), the busy state and each tag's last error or
// confirmation. The rules of a draft: $lib/options/drafts.ts.
import { createTag, deleteTag, saveTag } from '#lib/api/tags.js';
import type { TagDefinition } from '#lib/api/types.js';
import {
	newDraft,
	newValue,
	problems,
	toBody,
	toDraft,
	type TagActions,
	type TagDraft,
	type ValueDraft
} from '#lib/options/drafts.js';

export class TagOptions implements TagActions {
	drafts = $state<TagDraft[]>([]);
	busy = $state(false);
	/** Per draft key: the last error, or a confirmation ('saved'). */
	errors = $state<Record<number, unknown>>({});
	saved = $state<Record<number, boolean>>({});
	/** Per draft key: the tag as the server has it (to go back to). */
	#server = new Map<number, TagDefinition>();

	constructor(tags: TagDefinition[]) {
		this.drafts = tags.map((tag) => this.#loaded(tag));
	}

	/** A new, empty tag at the top of the list. */
	add = (): TagDraft => {
		const draft = newDraft();
		this.drafts.unshift(draft);
		return this.drafts[0];
	};

	addValue = (draft: TagDraft) => draft.values.push(newValue());
	removeValue = (draft: TagDraft, value: ValueDraft) => {
		draft.values = draft.values.filter((v) => v.key !== value.key);
	};

	/** Create or save it (a new ID renames it everywhere); true when done. */
	save = (draft: TagDraft) =>
		this.#run(draft, async () => {
			if (problems(draft).length) return false;
			const body = toBody(draft);
			const tag = draft.savedId === null ? await createTag(body) : await saveTag(draft.savedId, body);
			this.#replace(draft, this.#loaded(tag, draft.key));
			this.saved[draft.key] = true;
			return true;
		});

	/** Back to what the server has (a new tag: gone). */
	discard = (draft: TagDraft) => {
		const tag = this.#server.get(draft.key);
		if (tag) this.#replace(draft, toDraft(tag, draft.key));
		else this.#drop(draft);
		delete this.errors[draft.key];
		delete this.saved[draft.key];
	};

	/** Delete it (refused by the server while a video or segment uses it). Confirm first. */
	remove = (draft: TagDraft) =>
		this.#run(draft, async () => {
			if (draft.savedId !== null) await deleteTag(draft.savedId);
			this.#drop(draft);
			return true;
		});

	#loaded(tag: TagDefinition, key?: number): TagDraft {
		const draft = toDraft(tag, key);
		this.#server.set(draft.key, tag);
		return draft;
	}

	#replace(draft: TagDraft, by: TagDraft) {
		const i = this.drafts.findIndex((d) => d.key === draft.key);
		this.drafts[i] = by;
	}

	#drop(draft: TagDraft) {
		this.drafts = this.drafts.filter((d) => d.key !== draft.key);
		this.#server.delete(draft.key);
	}

	async #run(draft: TagDraft, action: () => Promise<boolean>): Promise<boolean> {
		this.busy = true;
		delete this.errors[draft.key];
		delete this.saved[draft.key];
		try {
			return await action();
		} catch (e) {
			this.errors[draft.key] = e;
			return false;
		} finally {
			this.busy = false;
		}
	}
}
