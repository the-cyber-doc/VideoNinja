import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, apiHeaders, errorFromBody, errorText, ndjson } from './client';
import { setLang } from '../i18n.svelte';

afterEach(() => {
	setLang('en');
	vi.unstubAllGlobals();
});

describe('error answers', () => {
	it("shows the code's text, never the server's detail", () => {
		const e = errorFromBody(422, {
			code: 'segment.unknown_technique',
			detail: 'Unknown technique: x',
			params: { technique: 'x' }
		});
		expect([e.status, e.code, e.message]).toEqual([422, 'segment.unknown_technique', 'Unknown technique: x.']);
		setLang('fr');
		expect(errorText(e.code, e.params)).toBe('Technique inconnue : x.');
	});

	it('takes the placeholders from params', () => {
		const e = errorFromBody(429, { code: 'throttled', detail: '…', params: { minutes: 11 } });
		expect(e.message).toBe('Too many failed attempts. Try again in 11 min.');
	});

	it('falls back to the status for a code it does not know (newer server)', () => {
		expect(errorFromBody(409, { code: 'video.something_new', detail: 'New' }).message).toBe(
			'The server refused the request (HTTP 409).'
		);
	});

	it('reads the status of an answer without JSON (nginx)', () => {
		expect(errorFromBody(413, null).code).toBe('upload.too_large');
		expect(errorFromBody(429, '<html>').code).toBe('rate_limited');
		expect(errorFromBody(502, null).message).toBe('The server refused the request (HTTP 502).');
	});
});

describe('api()', () => {
	it('throws the translated error of a failed answer', async () => {
		setLang('fr');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({ code: 'user.exists', detail: 'This username already exists', params: {} }, { status: 409 })
			)
		);
		const e = (await api('/api/admin/users', { username: 'kenji', role: 'user' }).catch((e) => e)) as ApiError;
		expect(e).toBeInstanceOf(ApiError);
		expect([e.status, e.message]).toEqual([409, "Ce nom d'utilisateur est déjà pris."]);
		expect(e.requestId).toBeNull(); // none in this answer
	});

	it("keeps the answer's request ID, to quote it", async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json(
					{ code: 'internal', detail: 'Internal error', params: {} },
					{ status: 500, headers: { 'X-Request-ID': '0123456789abcdef0123456789abcdef' } }
				)
			)
		);
		const e = (await api('/api/videos').catch((e) => e)) as ApiError;
		expect(e.requestId).toBe('0123456789abcdef0123456789abcdef');
	});

	it('says the server cannot be reached when there is no answer', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		const e = (await api('/api/auth/me').catch((e) => e)) as ApiError;
		expect([e.status, e.code, e.message]).toEqual([
			0,
			'network',
			'Cannot reach the server. Check your connection and try again.'
		]);
	});
});

describe('transport', () => {
	it('no content: undefined, not a JSON error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 204 }))
		);
		expect(await api('/api/auth/logout', {})).toBeUndefined();
	});

	it('sends the language and the timezone', () => {
		setLang('fr');
		expect(apiHeaders()).toEqual({
			'Accept-Language': 'fr',
			'Time-Zone': Intl.DateTimeFormat().resolvedOptions().timeZone
		});
	});

	it('NDJSON: lines split across chunks, blank lines skipped, the last one without its newline', async () => {
		const chunks = ['{"step":"sch', 'ema"}\n\n{"step":', '"data"}\n{"step":"done"}'];
		const body = new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
				controller.close();
			}
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(body))
		);
		const lines = [];
		for await (const line of ndjson('/api/setup/complete', {})) lines.push(line);
		expect(lines).toEqual([{ step: 'schema' }, { step: 'data' }, { step: 'done' }]);
	});
});

describe('answers that are not the API’s', () => {
	it('a page instead of JSON (nginx): the error from its status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 }))
		);
		const e = (await api('/api/videos').catch((e) => e)) as ApiError;
		expect([e.status, e.code]).toEqual([502, 'http_error']);
	});

	it('an unknown code without a status: the generic error', () => {
		expect(errorText('something.new')).toBe(errorText('internal'));
	});
});
