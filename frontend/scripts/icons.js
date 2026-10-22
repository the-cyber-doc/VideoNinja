// PWA icons (static/icons/*.png) from static/favicon.svg, rendered by
// Playwright's Chromium: no image tool to install. Run after changing the SVG:
//   npm run icons
// "any" icons keep the transparent corners; "maskable" and Apple icons get a
// solid background, the artwork inside the 80 % safe zone (the OS crops the rest).
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync(new URL('../static/favicon.svg', import.meta.url), 'utf8');
const out = new URL('../static/icons/', import.meta.url);
const BACKGROUND = '#f6f5f2'; // --bg (app.css), also the manifest's background_color

const ICONS = [
	{ file: 'icon-192.png', size: 192, padded: false },
	{ file: 'icon-512.png', size: 512, padded: false },
	{ file: 'icon-maskable-512.png', size: 512, padded: true },
	{ file: 'apple-touch-icon.png', size: 180, padded: true } // iOS: no transparency
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, padded } of ICONS) {
	const art = padded ? Math.round(size * 0.7) : size;
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;` +
			`background:${padded ? BACKGROUND : 'transparent'}">` +
			`<div style="width:${art}px;height:${art}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`
	);
	await page.screenshot({ path: new URL(file, out).pathname, omitBackground: !padded });
	console.log(`static/icons/${file}`);
}
await browser.close();
