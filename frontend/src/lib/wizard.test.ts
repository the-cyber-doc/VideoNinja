import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/client';
import { t } from './i18n.svelte';
import { Wizard, type WizardDeps } from './wizard.svelte';

const TOTP = { secret: 'S'.repeat(32), uri: 'otpauth://totp/x', qr: 'data:image/svg+xml,…' };

async function* stream(...lines: { step?: string; error?: unknown }[]) {
	yield* lines;
}

function fakes(over: Partial<WizardDeps> = {}): WizardDeps {
	return {
		isInitialized: async () => false,
		verifySetupToken: async () => {},
		setupTotp: async () => TOTP,
		completeSetup: () => stream({ step: 'schema' }, { step: 'data' }, { step: 'admin' }, { step: 'done' }),
		verifyInvite: async () => ({ username: 'kenji' }),
		inviteTotp: async () => TOTP,
		completeRegistration: async () => {},
		...over
	};
}

/** Through the account step, as a user would fill it. */
async function account(w: Wizard) {
	w.password = w.password2 = 'a long passphrase';
	await w.submitAccount();
	w.totpCode = '123456';
}

describe('setup (first start)', () => {
	it('token → admin → authenticator → the database built, task by task', async () => {
		const completeSetup = vi.fn(() =>
			stream({ step: 'schema' }, { step: 'data' }, { step: 'admin' }, { step: 'done' })
		);
		const w = new Wizard(undefined, fakes({ completeSetup }));
		expect([w.setup, w.username, w.step, w.position]).toEqual([true, 'admin', 'token', 0]);
		expect(await w.start()).toBeNull();
		w.token = '  tok  ';
		await w.submitToken();
		expect(w.step).toBe('account');
		await account(w);
		expect([w.step, w.totp]).toEqual(['authenticator', TOTP]);
		await w.submitTotp();
		expect(completeSetup).toHaveBeenCalledWith(
			expect.objectContaining({ token: 'tok', username: 'admin', totp_code: '123456' })
		);
		expect([w.step, w.completed, w.finished, w.position]).toEqual([
			'done',
			['schema', 'data', 'admin', 'done'],
			true,
			4
		]);
		expect(w.password).toBe(''); // not kept in memory once used
	});

	it('set up already: the page goes to the login', async () => {
		expect(await new Wizard(undefined, fakes({ isInitialized: async () => true })).start()).toBe('login');
	});

	it('a wrong token stays on its step, with the reason', async () => {
		const refused = new ApiError(403, 'setup.invalid_token');
		const w = new Wizard(undefined, fakes({ verifySetupToken: async () => Promise.reject(refused) }));
		await w.submitToken();
		expect([w.step, w.error, w.busy]).toEqual(['token', refused, false]);
	});

	it('passwords that differ: said at once, nothing asked from the server', async () => {
		const setupTotp = vi.fn();
		const w = new Wizard(undefined, fakes({ setupTotp }));
		w.password = 'one long passphrase';
		w.password2 = 'another passphrase';
		await w.submitAccount();
		expect(w.error).toBe(t('common.passwords_mismatch'));
		expect(setupTotp).not.toHaveBeenCalled();
	});

	it('a failure during the build: shown, not finished', async () => {
		const w = new Wizard(
			undefined,
			fakes({
				completeSetup: () => stream({ step: 'schema' }, { error: { code: 'setup.failed', detail: '…', params: {} } })
			})
		);
		await account(w);
		await w.submitTotp();
		expect(w.completed).toEqual(['schema']);
		expect((w.error as ApiError).code).toBe('setup.failed');
		expect(w.finished).toBe(false);
	});

	it('a stream that ends early is an error', async () => {
		const w = new Wizard(undefined, fakes({ completeSetup: () => stream({ step: 'schema' }) }));
		await account(w);
		await w.submitTotp();
		expect(w.error).toEqual(new Error(t('wizard.setup_unexpected_end')));
	});

	it('back from the authenticator to the account', async () => {
		const w = new Wizard(undefined, fakes());
		await account(w);
		w.back();
		expect(w.step).toBe('account');
	});
});

describe('registration (an invitation)', () => {
	it('the invitation names the user; then the account and the authenticator', async () => {
		const completeRegistration = vi.fn(async () => {});
		const w = new Wizard('inv', fakes({ completeRegistration }));
		expect(w.setup).toBe(false);
		await w.start();
		expect([w.username, w.step]).toEqual(['kenji', 'account']);
		await account(w);
		await w.submitTotp();
		expect(completeRegistration).toHaveBeenCalledWith(expect.objectContaining({ token: 'inv', totp_code: '123456' }));
		expect([w.step, w.finished, w.position]).toEqual(['done', true, 4]);
	});

	it('an invalid invitation: its reason, on the first step', async () => {
		const invalid = new ApiError(404, 'invite.invalid');
		const w = new Wizard('bad', fakes({ verifyInvite: async () => Promise.reject(invalid) }));
		await w.start();
		expect([w.step, w.error]).toEqual(['token', invalid]);
	});
});

describe('the setup task under way', () => {
	it('the first not completed, only while busy', () => {
		const w = new Wizard(undefined, fakes());
		expect(w.currentTask).toBeNull();
		w.busy = true;
		expect(w.currentTask).toBe('schema');
		w.completed = ['schema', 'data', 'admin', 'done'];
		expect(w.currentTask).toBeNull();
	});
});
