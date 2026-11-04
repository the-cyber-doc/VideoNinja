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
