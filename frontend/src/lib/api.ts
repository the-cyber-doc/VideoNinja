import { i18n } from './i18n.svelte';

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export interface User {
	username: string;
	name: string | null;
	role: string;
	/** The role's name in the current language. */
	role_name: string;
	/** What the role allows, e.g. 'user_mgmt'. Only hides menus: the API enforces it. */
	access: string[];
}

async function errorMessage(res: Response): Promise<string> {
	try {
		const detail = (await res.json()).detail;
		if (typeof detail === 'string') return detail;
		// FastAPI validation errors: [{msg, loc, ...}]
		if (Array.isArray(detail)) return detail.map((e) => e.msg).join(', ');
	} catch {
		// not JSON
	}
	return `HTTP ${res.status}`;
}

async function request(path: string, body?: unknown): Promise<Response> {
	const res = await fetch(path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: {
			// Translated content (role names, descriptions…) comes back in this language.
			'Accept-Language': i18n.lang,
			...(body === undefined ? {} : { 'Content-Type': 'application/json' })
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		credentials: 'same-origin'
	});
	if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
	return res;
}

/** GET when body is undefined, POST JSON otherwise. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
	const res = await request(path, body);
	return res.status === 204 ? (undefined as T) : res.json();
}

/** POST JSON and yield each line of an NDJSON (one JSON object per line) response. */
export async function* ndjson<T>(path: string, body: unknown): AsyncGenerator<T> {
	const res = await request(path, body);
	const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		const lines = buffer.split('\n');
		buffer = lines.pop()!;
		for (const line of lines) if (line.trim()) yield JSON.parse(line);
	}
	if (buffer.trim()) yield JSON.parse(buffer);
}

export const isInitialized = async () =>
	(await api<{ initialized: boolean }>('/api/setup/status')).initialized;

/** The logged-in user, or null. */
export async function currentUser(): Promise<User | null> {
	try {
		return await api<User>('/api/auth/me');
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) return null;
		throw e;
	}
}
