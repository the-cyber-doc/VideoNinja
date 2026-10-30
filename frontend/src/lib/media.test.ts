// URLs and facts the pages derive from the build and the catalogue.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as about from './about';
import type { Segment } from './catalog.svelte';
import { clipUrl, segmentDuration, thumbnailUrl, videoThumbnailUrl, videoUrl } from './media';
import { NAV } from './nav';

const segment = { id: 4, video: 2, technique: 't', begin_s: 12, end_s: 27, performer: 'p' } as Segment;

describe('media URLs', () => {
	it('by ID only: the server finds the video and the times', () => {
		expect([clipUrl(segment), thumbnailUrl(segment), videoUrl(2), videoThumbnailUrl(2)]).toEqual([
			'/media/segment/4',
			'/media/segment/4/thumbnail',
			'/media/video/2',
			'/media/video/2/thumbnail'
		]);
		expect(segmentDuration(segment)).toBe(15);
	});
});

describe('the main navigation', () => {
	it('each entry is a page of the app', () => {
		const pages = readdirSync(new URL('../routes/(app)', import.meta.url), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => `/${entry.name}`);
		for (const entry of NAV) expect(pages).toContain(entry.href);
	});
});

describe('about this build', () => {
	it('a version, a commit, a date, and where the sources are', () => {
		expect(about.version).toMatch(/^(dev|\d+\.\d+\.\d+)$/);
		expect(about.build).not.toBe('');
		expect(Number.isNaN(about.buildDate.getTime())).toBe(false);
		expect(about.LICENSE_URL.startsWith(about.GITHUB_URL)).toBe(true);
		expect([about.DOCKER_URL, about.COPYRIGHT_HOLDER]).toEqual([
			'https://hub.docker.com/u/thecyberdoc',
			'the-cyber-doc'
		]);
	});
});
