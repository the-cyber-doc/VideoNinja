import { readFileSync } from 'node:fs';
import {
	expect,
	test,
	type APIRequestContext,
	type APIResponse,
	type Browser,
	type BrowserContext
} from '@playwright/test';
import { TOTP } from 'otpauth';

// Accounts on the real stack (projects options, videos, stack): every credential POST goes
// through nginx's limit (60/min, burst 30), shared by the specs running at the same time and
// mostly used up by account.spec.ts, so each one waits and tries again on nginx's 429.

export interface Account {
	username: string;
	password: string;
	totpSecret: string;
}

/** The admin left by tests/e2e/account.spec.ts (its last password and authenticator). */
export function admin(): Account {
	return JSON.parse(readFileSync('.e2e/admin.json', 'utf8'));
}

/** A credential POST; on nginx's 429, waits as Retry-After says and tries again. `data` is
 * made again for each try (a TOTP code may have expired). */
export async function credentialPost(
	request: APIRequestContext,
	path: string,
	data: () => object
): Promise<APIResponse> {
	for (let attempt = 0; ; attempt++) {
		const res = await request.post(path, { data: data() });
		if (res.status() !== 429 || attempt === 20) return res;
		await new Promise((done) => setTimeout(done, Number(res.headers()['retry-after'] ?? 5) * 1000));
	}
}

/** A context of its own, logged in through the API (its session cookie kept by the context). */
export async function loggedIn(browser: Browser, who: Account): Promise<BrowserContext> {
	const context = await browser.newContext({
		baseURL: test.info().project.use.baseURL,
		ignoreHTTPSErrors: true,
		locale: 'en-US'
	});
	const res = await credentialPost(context.request, 'api/auth/login', () => ({
		username: who.username,
		password: who.password,
		totp_code: new TOTP({ secret: who.totpSecret }).generate()
	}));
	expect(res.status()).toBe(200);
	return context;
}

/** An account with this role, invited by the admin (`request`: its session) and registered
 * through the API; `name` = its display name. */
export async function register(
	request: APIRequestContext,
	username: string,
	role: string,
	name?: string
): Promise<Account> {
	const invite = await request.post('api/admin/users', { data: { username, role } });
	expect(invite.status()).toBe(201);
	const { token } = await invite.json();
	const enrol = await credentialPost(request, 'api/register/totp', () => ({ token }));
	expect(enrol.status()).toBe(200);
	const { secret } = await enrol.json();
	const who = { username, password: `${username}'s long password`, totpSecret: secret };
	const done = await credentialPost(request, 'api/register/complete', () => ({
		token,
		...(name === undefined ? {} : { name }),
		password: who.password,
		totp_secret: secret,
		totp_code: new TOTP({ secret }).generate()
	}));
	expect(done.status()).toBe(204);
	return who;
}
