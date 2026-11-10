// Driving the book viewer (EmbedPDF) as a person: shared by the mocked and the stack specs.
import { expect, type Page } from '@playwright/test';

/** A drag as a person makes it: pointer moves a frame apart (the viewer follows them per frame). */
export async function drag(page: Page, from: [number, number], to: [number, number], steps = 12) {
	await page.mouse.move(...from);
	await page.mouse.down();
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
		await page.waitForTimeout(30);
	}
	await page.mouse.up();
}

/** Page 1 of the viewer, once drawn: its box on the screen. */
export async function pageBox(page: Page) {
	const sheet = page.locator('.page[data-page="1"]');
	await expect(sheet).toBeVisible({ timeout: 20_000 });
	await expect(sheet.locator('img').first()).toBeVisible({ timeout: 20_000 }); // rendered
	return (await sheet.boundingBox())!;
}

export type RGB = [number, number, number];
/** A blue drawn over the page's white (a translucent blue highlight): blue well above red. */
export const bluish = ([r, , b]: RGB) => b - r > 40;
/** A yellow drawn over white: red well above blue. */
export const yellowish = ([r, , b]: RGB) => r - b > 40;

/** The colour mostly drawn in a part of the screen (inside a highlight: the page's white, tinted
 * by it; its letters are fewer pixels). What the person sees, whatever draws it (the plugin's
 * element or the PDF's own appearance). Decoded in the page: nothing to add to the tests' dependencies. */
export async function drawnColor(page: Page, clip: { x: number; y: number; width: number; height: number }) {
	const png = (await page.screenshot({ clip })).toString('base64');
	return page.evaluate(async (data): Promise<RGB> => {
		const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
		const picture = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		const canvas = new OffscreenCanvas(picture.width, picture.height);
		const context = canvas.getContext('2d')!;
		context.drawImage(picture, 0, 0);
		const px = context.getImageData(0, 0, picture.width, picture.height).data;
		const counts = new Map<string, number>();
		for (let i = 0; i < px.length; i += 4) {
			const key = [px[i], px[i + 1], px[i + 2]].map((v) => (v >> 3) << 3).join(','); // close shades together
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		const [mode] = [...counts].sort((a, b) => b[1] - a[1])[0];
		return mode.split(',').map(Number) as RGB;
	}, png);
}

/** A finger's drag (Chromium: touch events through the DevTools protocol, which scroll as a real
 * finger does), held still `holdMs` first (a long press). */
export async function touchDrag(page: Page, from: [number, number], to: [number, number], holdMs = 0, steps = 10) {
	const cdp = await page.context().newCDPSession(page);
	const at = (x: number, y: number) => [{ x: Math.round(x), y: Math.round(y) }];
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(...from) });
	if (holdMs) await page.waitForTimeout(holdMs);
	for (let i = 1; i <= steps; i++) {
		const x = from[0] + ((to[0] - from[0]) * i) / steps;
		const y = from[1] + ((to[1] - from[1]) * i) / steps;
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x, y) });
		await page.waitForTimeout(16);
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
}
