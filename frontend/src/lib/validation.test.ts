import { describe, expect, it } from 'vitest';
import { rules, totpDigits } from './validation';

describe('totpDigits', () => {
	it('keeps digits only', () => expect(totpDigits('123 456')).toBe('123456'));
	it('ignores letters and dashes', () => expect(totpDigits('12a3-4')).toBe('1234'));
	it('cuts at the code length', () => expect(totpDigits('1234567')).toBe('123456'));
});

describe('shared rules', () => {
	// Browsers compile the HTML pattern attribute with the 'v' flag, stricter than Python.
	it.each(Object.entries(rules).filter(([, r]) => 'pattern' in r))(
		'%s pattern compiles as in a browser',
		(_, rule) => {
			expect(() => new RegExp(`^(?:${(rule as { pattern: string }).pattern})$`, 'v')).not.toThrow();
		}
	);

	it('accepts and refuses usernames like the backend', () => {
		const re = new RegExp(`^(?:${rules.username.pattern})$`, 'v');
		expect(re.test('a.b_c-d')).toBe(true);
		expect(re.test('Admin')).toBe(false);
		expect(re.test('a b')).toBe(false);
	});
});
