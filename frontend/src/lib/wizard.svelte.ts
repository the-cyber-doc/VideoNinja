// The account wizard's steps (AccountWizard.svelte shows them), for two pages:
// - setup (first start): the setup token from the server's logs → the admin's
//   account → an authenticator → the database built (the server reports each task);
// - register (an invitation link): the invitation checked (it names the user) → the
//   account → an authenticator → done.
// Nothing is created before the last step. Its API functions are passed in: tests
// give fakes.
import { errorFromBody } from './api/client';
import * as register from './api/register';
import * as setupApi from './api/setup';
import type { TotpEnrollment } from './api/types';
import { t, type MessageKey } from './i18n.svelte';

export type Step = 'token' | 'account' | 'authenticator' | 'done';
export const STEPS: readonly Step[] = ['token', 'account', 'authenticator', 'done'];
/** The setup's tasks as the server reports them, in order. */
export const INIT_TASKS = ['schema', 'data', 'admin', 'done'] as const;

const LABELS: Record<'setup' | 'register', Record<Step, MessageKey>> = {
	setup: {
		token: 'wizard.step.setup_token',
		account: 'wizard.step.admin',
		authenticator: 'wizard.step.authenticator',
		done: 'wizard.step.init'
	},
	register: {
		token: 'wizard.step.invitation',
		account: 'wizard.step.account',
		authenticator: 'wizard.step.authenticator',
		done: 'wizard.step.done'
	}
};

export interface WizardDeps {
	isInitialized: () => Promise<boolean>;
	verifySetupToken: (token: string) => Promise<void>;
	setupTotp: (token: string, username: string) => Promise<TotpEnrollment>;
	completeSetup: typeof setupApi.complete;
	verifyInvite: (token: string) => Promise<{ username: string }>;
	inviteTotp: (token: string) => Promise<TotpEnrollment>;
	completeRegistration: typeof register.complete;
}

const DEPS: WizardDeps = {
	isInitialized: setupApi.isInitialized,
	verifySetupToken: setupApi.verifyToken,
	setupTotp: setupApi.newTotp,
	completeSetup: setupApi.complete,
	verifyInvite: register.verifyInvite,
	inviteTotp: register.newTotp,
	completeRegistration: register.complete
};

export class Wizard {
	readonly setup: boolean;
	readonly labels: MessageKey[];
	step = $state<Step>('token');
	busy = $state(false);
	error = $state<unknown>(null);
	// The form's fields
	token = $state('');
	username = $state('');
	name = $state('');
	password = $state('');
	password2 = $state('');
	totpCode = $state('');
	/** The new authenticator's secret and QR code (nothing stored before the last step). */
	totp = $state<TotpEnrollment | null>(null);
	/** The setup's tasks done so far (INIT_TASKS). */
	completed = $state<string[]>([]);
	#registered = $state(false);

	/** `invite`: the invitation's token (registration); none: the first start's setup. */
	constructor(
		private readonly invite?: string,
		private readonly deps: WizardDeps = DEPS
	) {
		this.setup = invite === undefined;
		this.labels = STEPS.map((step) => LABELS[this.setup ? 'setup' : 'register'][step]);
		if (this.setup) this.username = 'admin';
	}

	/** At the page's start. Setup: 'login' when it is done already (the page goes there).
	 * Registration: the invitation checked at once, the user sees who it is for or why it fails. */
	async start(): Promise<'login' | null> {
		if (this.setup) return (await this.deps.isInitialized()) ? 'login' : null;
		await this.#run(async () => {
			this.username = (await this.deps.verifyInvite(this.invite!)).username;
			this.step = 'account';
		});
		return null;
	}

	/** Setup: the token from the server's logs. */
	submitToken = () =>
		this.#run(async () => {
			await this.deps.verifySetupToken(this.token.trim());
			this.step = 'account';
		});

	/** The account's fields: a new authenticator to scan next. */
	submitAccount = () => {
		if (this.password !== this.password2) {
			this.error = t('common.passwords_mismatch');
			return Promise.resolve();
		}
		return this.#run(async () => {
			this.totp = this.setup
				? await this.deps.setupTotp(this.token.trim(), this.username)
				: await this.deps.inviteTotp(this.invite!);
			this.step = 'authenticator';
		});
	};

	back = () => (this.step = 'account');

	/** A code from the new authenticator: the account is created (setup: and the database). */
	submitTotp = () =>
		this.#run(async () => {
			const credentials = { name: this.name, password: this.password, totp_secret: this.totp!.secret, totp_code: this.totpCode };
			if (!this.setup) {
				await this.deps.completeRegistration({ token: this.invite!, ...credentials });
				this.#forgetPasswords();
				this.#registered = true;
				this.step = 'done';
				return;
			}
			// Validation errors (e.g. a wrong code) throw here, before anything is created.
			// A failure after the answer started (status 200 sent): {error: {code, detail, params}}.
			const events = this.deps.completeSetup({ token: this.token.trim(), username: this.username, ...credentials });
			const first = await events.next();
			this.step = 'done';
			for (let r = first; !r.done; r = await events.next()) {
				if (r.value.error) throw errorFromBody(0, r.value.error);
				if (r.value.step) this.completed = [...this.completed, r.value.step];
			}
			this.#forgetPasswords();
			if (!this.finished) throw new Error(t('wizard.setup_unexpected_end'));
		});

	/** The account created (setup: the database built too). */
	get finished(): boolean {
		return this.setup ? this.completed.includes('done') : this.#registered;
	}

	/** The step's position, for the stepper and the progress bar (all done: STEPS.length). */
	get position(): number {
		return this.finished ? STEPS.length : STEPS.indexOf(this.step);
	}

	/** The setup task under way (shown as "…"), or null. */
	get currentTask(): string | null {
		return this.busy ? (INIT_TASKS.find((task) => !this.completed.includes(task)) ?? null) : null;
	}

	#forgetPasswords() {
		this.password = this.password2 = '';
	}

	async #run(action: () => Promise<void>) {
		this.busy = true;
		this.error = null;
		try {
			await action();
		} catch (e) {
			this.error = e;
		} finally {
			this.busy = false;
		}
	}
}
