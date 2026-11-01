// A tag's rule, as /api/tags sends it: the upload and Videos pages' tag input and the
// Options page's test field both check values here, so they always agree (the server
// checks again: server/app/domain/tags.py). Data only: no code knows a particular tag.
import type { MessageKey } from './i18n.svelte';
import type { Tag } from './api/types';

/** The rule part of a tag (an Options page draft has it too, before it is saved). */
export type TagRule = Pick<Tag, 'format' | 'values' | 'pattern' | 'min' | 'max'>;

/** Why a value is refused: a message (error.tag.*, the server's own) and its params, but the tag. */
export interface Problem {
	key: MessageKey;
	params: Record<string, string | number>;
}

const NUMBER = /^-?[0-9]+$/;

/**
 * The whole value matching `pattern`, or null when JavaScript cannot use it. The 'v'
 * flag, as for the HTML pattern attribute (validation.json's rules): Python must
 * accept it too (the server checks that).
 */
export function compilePattern(pattern: string): RegExp | null {
	try {
		return new RegExp(`^(?:${pattern})$`, 'v');
	} catch {
		return null;
	}
}

/** Why `value` ('' = none) is not accepted by a tag with this rule, or null. */
export function valueProblem(rule: TagRule, value: string): Problem | null {
	if (!rule.format) return value ? { key: 'error.tag.no_value', params: {} } : null;
	if (!value) return { key: 'error.tag.missing_value', params: {} };
	if (rule.format === 'list') {
		return rule.values?.some((v) => v.id === value) ? null : { key: 'error.tag.value', params: {} };
	}
	if (rule.format === 'regexp' && !compilePattern(rule.pattern ?? '')?.test(value)) {
		return { key: 'error.tag.pattern', params: { pattern: rule.pattern ?? '' } };
	}
	if (rule.min != null || rule.max != null) {
		const number = NUMBER.test(value) ? Number(value) : null;
		if (number === null || (rule.min != null && number < rule.min) || (rule.max != null && number > rule.max)) {
			return { key: 'error.tag.range', params: { min: rule.min ?? '…', max: rule.max ?? '…' } };
		}
	}
	return null;
}

// Translation IDs, made from the IDs (as the server does): shown on the Options page.
export const nameId = (tag: string) => `tag.${tag}.name`;
export const hintId = (tag: string) => `tag.${tag}.hint`;
export const valueNameId = (tag: string, value: string) => `tag_value.${tag}.${value}.name`;
