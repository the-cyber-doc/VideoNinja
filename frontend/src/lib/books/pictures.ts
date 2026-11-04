// A picture the browser made (a book's first page, a region's crop) sent to the server:
// tus (kind "image"), its SHA-256 announced. The API call that uses it comes after.
import { sha256File } from '../upload/hash';
import { startUpload } from '../upload/upload';

export async function uploadPicture(picture: Blob, name: string): Promise<string> {
	const sha256 = await sha256File(picture);
	return new Promise((resolve, reject) => {
		startUpload(
			picture as File,
			{ sha256, originalFilename: name, kind: 'image' },
			{
				onUrl: () => {},
				onProgress: () => {},
				onRetry: () => {},
				onSuccess: resolve,
				onError: reject
			}
		);
	});
}
