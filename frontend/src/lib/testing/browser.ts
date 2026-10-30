// Fakes of the browser APIs the app's modules use (unit tests run in Node): the Cache
// API, IndexedDB (only what draft.svelte.ts calls), the page's service worker
// container. In memory, per test: install them with vi.stubGlobal.

export const ORIGIN = 'https://app.test';

/** A request's absolute URL: a Request, a request-like object ({url}: Node builds no
 * navigation Request), a URL or a path. */
export const urlOf = (request: RequestInfo | URL | { url: string }) =>
	new URL(typeof request === 'object' && 'url' in request ? request.url : String(request), ORIGIN).href;
const key = urlOf;

/** One cache: responses by absolute URL, a fresh copy on every match. */
export class FakeCache {
	entries = new Map<string, Response>();

	async match(request: RequestInfo | URL) {
		return this.entries.get(key(request))?.clone();
	}
	async put(request: RequestInfo | URL, response: Response) {
		this.entries.set(key(request), response);
	}
	async delete(request: RequestInfo | URL) {
		return this.entries.delete(key(request));
	}
	async keys() {
		return [...this.entries.keys()].map((url) => new Request(url));
	}
	async addAll(requests: RequestInfo[]) {
		for (const request of requests) await this.put(request, await fetch(key(request)));
	}
}

export class FakeCacheStorage {
	caches = new Map<string, FakeCache>();

	async open(name: string) {
		if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
		return this.caches.get(name)!;
	}
	async has(name: string) {
		return this.caches.has(name);
	}
	async delete(name: string) {
		return this.caches.delete(name);
	}
	async keys() {
		return [...this.caches.keys()];
	}
	async match(request: RequestInfo | URL, options: { cacheName?: string } = {}) {
		const names = options.cacheName ? [options.cacheName] : [...this.caches.keys()];
		for (const name of names) {
			const found = await this.caches.get(name)?.match(request);
			if (found) return found;
		}
		return undefined;
	}
}

/** navigator.serviceWorker of a page: its controller, and the messages from the worker. */
export class FakeContainer extends EventTarget {
	posted: unknown[] = [];
	controller: { postMessage: (message: unknown) => void } | null = {
		postMessage: (message) => this.posted.push(message)
	};
	registrations: { unregister: () => void }[] = [];
	register = async () => ({ update: async () => {} });
	getRegistrations = async () => this.registrations;

	/** A message from the service worker. */
	send(data: unknown) {
		this.dispatchEvent(new MessageEvent('message', { data }));
	}
}

// --- IndexedDB: one database of object stores keyed by a path, requests answered
// asynchronously as the real ones, or failing on demand. ---

type Handler = ((this: unknown) => void) | null;

class FakeRequest<T> {
	result!: T;
	error: Error | null = null;
	onsuccess: Handler = null;
	onerror: Handler = null;
	onupgradeneeded: Handler = null;

	/** `upgrade`: before the success, as a new database's onupgradeneeded. */
	constructor(run: () => T, failing: boolean, upgrade = false) {
		setTimeout(() => {
			if (failing) {
				this.error = new Error('storage blocked');
				this.onerror?.call(this);
				return;
			}
			this.result = run();
			if (upgrade) this.onupgradeneeded?.call(this);
			this.onsuccess?.call(this);
		});
	}
}

class FakeStore {
	rows = new Map<string, unknown>();
	constructor(
		private keyPath: string,
		private factory: FakeIndexedDB
	) {}
	#request<T>(run: () => T) {
		return new FakeRequest(run, this.factory.failing || this.factory.failingRequests);
	}
	get(id: string) {
		return this.#request(() => structuredClone(this.rows.get(id)));
	}
	getAll() {
		return this.#request(() => [...this.rows.values()].map((row) => structuredClone(row)));
	}
	put(row: Record<string, unknown>) {
		return this.#request(() => void this.rows.set(String(row[this.keyPath]), structuredClone(row)));
	}
	delete(id: string) {
		return this.#request(() => void this.rows.delete(id));
	}
}

class FakeDatabase {
	stores = new Map<string, FakeStore>();
	closed = false;
	constructor(private factory: FakeIndexedDB) {}
	createObjectStore(name: string, options: { keyPath: string }) {
		this.stores.set(name, new FakeStore(options.keyPath, this.factory));
	}
	transaction(name: string) {
		return { objectStore: () => this.stores.get(name)! };
	}
	close() {
		this.closed = true;
	}
}

export class FakeIndexedDB {
	databases = new Map<string, FakeDatabase>();
	deleted: string[] = [];
	/** Opening fails (storage blocked). */
	failing = false;
	/** Opening works, the requests on the stores fail. */
	failingRequests = false;

	open(name: string) {
		const isNew = !this.databases.has(name);
		if (isNew) this.databases.set(name, new FakeDatabase(this));
		const database = this.databases.get(name)!;
		return new FakeRequest(() => database, this.failing, isNew);
	}
	deleteDatabase(name: string) {
		this.deleted.push(name);
		this.databases.delete(name);
	}
}
