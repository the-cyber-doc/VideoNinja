import { i18n, isMessageKey, t } from '../i18n.svelte';
import { url } from '../base';

type Params = Record<string, string | number>;

/** A failed API call. The server answers every error as {code, detail, params}
 * (server/app/errors.py); `message` is the code's text in the user's language
 * (messages.json: error.<code>, `params` as its placeholders), never the server's
 * English `detail`. status 0: no answer at all (code 'network'). `requestId`: the
 * answer's X-Request-ID, in the server's logs ("request_id") and nginx's ("rid"). */
export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		public params: Params = {},
		public requestId: string | null = null
	) {
		super(errorText(code, params, status));
	}
}

/** The text of an error code in the current language. A code this version does not
 * know (a newer server than this cached app) falls back to the HTTP status. */
export function errorText(code: string, params: Params = {}, status = 0): string {
	const key = `error.${code}`;
	if (isMessageKey(key)) return t(key, params);
	return status ? t('error.http_error', { status }) : t('error.internal');
}

// An answer without the JSON (not from the app: nginx's own pages, e.g. a refused
// auth_request or a body over its size limit): its status says enough.
const BY_STATUS: Record<number, string> = {
	401: 'auth.not_logged_in',
	403: 'auth.access_denied',
	404: 'not_found',
	413: 'upload.too_large',
	429: 'rate_limited',
	503: 'busy'
};

interface ErrorBody {
	code: string;
	params?: Params;
}

const isErrorBody = (body: unknown): body is ErrorBody =>
	typeof body === 'object' && body !== null && typeof (body as ErrorBody).code === 'string';

/** The error of an answer with this status and (parsed JSON) body, if any. */
export function errorFromBody(status: number, body: unknown, requestId: string | null = null): ApiError {
	if (isErrorBody(body)) return new ApiError(status, body.code, body.params ?? {}, requestId);
	return new ApiError(status, BY_STATUS[status] ?? 'http_error', { status }, requestId);
}

async function responseError(res: Response): Promise<ApiError> {
	const body = await res.json().catch(() => null);
	return errorFromBody(res.status, body, res.headers.get('X-Request-ID'));
}

/** Sent on every API call. */
export function apiHeaders(): Record<string, string> {
	return {
		// Translated content (role names, descriptions…) comes back in this language.
		'Accept-Language': i18n.lang,
		// Dates are written in this timezone (IANA name, e.g. 'Europe/Zurich'), and the
		// server saves it for the user.
		'Time-Zone': Intl.DateTimeFormat().resolvedOptions().timeZone
	};
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request(path: string, body?: unknown, method?: Method): Promise<Response> {
	let res: Response;
	try {
		res = await fetch(url(path), {
			method: method ?? (body === undefined ? 'GET' : 'POST'),
			headers: {
				...apiHeaders(),
				...(body === undefined ? {} : { 'Content-Type': 'application/json' })
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			credentials: 'same-origin'
		});
	} catch {
		throw new ApiError(0, 'network'); // offline, server down, connection cut
	}
	if (!res.ok) throw await responseError(res);
	return res;
}

/** GET when body is undefined, POST JSON otherwise; or the method given (PATCH, DELETE). */
/** Use the typed functions of the modules beside this one (auth.ts, users.ts…): this is their transport. */
export async function api<T>(path: string, body?: unknown, method?: Method): Promise<T> {
	const res = await request(path, body, method);
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
