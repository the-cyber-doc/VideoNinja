import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorFromBody, errorText } from './client';
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
