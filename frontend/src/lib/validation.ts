// Input rules shared with the backend (server/app/validation.json), bundled at build time.
// The backend always validates again; these only give instant feedback in forms.
import rules from '../../../server/app/validation.json';

export { rules };

/** Keep the digits only (codes are often shown or copied as "123 456"), at most the code length. */
export function totpDigits(value: string): string {
	return value.replace(/\D/g, '').slice(0, rules.totp_code.max_length);
}

/** oninput handler for a TOTP field: rewrites the field so that non-digits never show. */
export function onTotpInput(event: Event & { currentTarget: HTMLInputElement }): string {
	const input = event.currentTarget;
	input.value = totpDigits(input.value);
	return input.value;
}
