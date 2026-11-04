// A picture the browser made, sent through tus as an "image" with its SHA-256.
import { describe, expect, it, vi } from 'vitest';
import type { UploadCallbacks } from '../upload/upload';

const startUpload = vi.fn();
vi.mock('../upload/upload', () => ({ startUpload }));
vi.mock('../upload/hash', () => ({ sha256File: async () => 'c'.repeat(64) }));
const { uploadPicture } = await import('./pictures');

describe('uploadPicture', () => {
	it('its tus ID once sent; the error otherwise', async () => {
		const picture = new Blob(['jpeg']);
		startUpload.mockImplementationOnce((_f, _m, callbacks: UploadCallbacks) => {
			callbacks.onUrl('/files/x');
			callbacks.onProgress(0.5);
			callbacks.onRetry();
			callbacks.onSuccess('tus-1');
		});
		expect(await uploadPicture(picture, 'thumb.jpg')).toBe('tus-1');
		expect(startUpload).toHaveBeenCalledWith(
			picture,
			{ sha256: 'c'.repeat(64), originalFilename: 'thumb.jpg', kind: 'image' },
			expect.anything()
		);
		startUpload.mockImplementationOnce((_f, _m, callbacks: UploadCallbacks) =>
			callbacks.onError(new Error('no') as never)
		);
		await expect(uploadPicture(picture, 'thumb.jpg')).rejects.toThrow('no');
	});
});
