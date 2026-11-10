<script module lang="ts">
	import type { BookAnnotation } from '../api/types';

	/** What the page does with the viewer: the panel's actions, and the engine's helpers. */
	export interface ViewerControls {
		/** Scroll to the annotation and select it. */
		select(row: BookAnnotation): void;
		/** Delete it (the plugin's delete, saved by BookAnnotations). */
		remove(row: BookAnnotation): void;
		/** Another colour (highlight fill, region outline). */
		recolor(row: BookAnnotation, color: string): void;
		/** A text highlight given new text: the user selects freely (as often as needed), then
		 * Annotate takes the selection on its page (its ends moved, the annotation kept):
		 * true once done, false if cancelled (cancelReselect, another mode, another reselect). */
		reselect(row: BookAnnotation): Promise<boolean>;
		cancelReselect(): void;
		crop(pageIndex: number, rect: Box): Promise<Blob | null>;
		/** Page 1 as the book's thumbnail (null: not rendered). */
		firstPage(): Promise<Blob | null>;
		/** Every page's text, for the search ("" for none). */
		pageTexts(): Promise<string[]>;
		/** Show this page (1 = the first). */
		showPage(page: number): void;
		/** A copy of the PDF (as uploaded) with these annotations written in it. */
		annotatedCopy(pdf: ArrayBuffer, annotations: { pageIndex: number }[]): Promise<ArrayBuffer>;
	}
</script>

<script lang="ts">
	// The viewer's inside (EmbedPDF's context): two modes and Annotate, zoom, the pages with
	// their text selection and annotation layers. Select: the text (EmbedPDF's own selection)
	// or an existing annotation; Annotate highlights the selected text. Create region: a
	// region drawn on a page (./region.ts: resized by its handles, moved; a new one replaces
	// it); Annotate makes it an annotation. The annotations are created through the plugin
	// (its tools' defaults), whose committed changes Viewer saves (BookAnnotations); its
	// selection and the panel's follow each other.
	import type { PdfEngine } from '@embedpdf/models';
	import { useDocumentState } from '@embedpdf/core/svelte';
	import { AnnotationLayer, useAnnotation, useAnnotationCapability } from '@embedpdf/plugin-annotation/svelte';
	import { PagePointerProvider } from '@embedpdf/plugin-interaction-manager/svelte';
	import { RenderLayer } from '@embedpdf/plugin-render/svelte';
	import { Scroller, useScroll, useScrollCapability } from '@embedpdf/plugin-scroll/svelte';
	import { Viewport } from '@embedpdf/plugin-viewport/svelte';
	import { SelectionLayer, useSelectionCapability } from '@embedpdf/plugin-selection/svelte';
	import { useZoom } from '@embedpdf/plugin-zoom/svelte';
	import ErrorMessage from '../ErrorMessage.svelte';
	import { t } from '../i18n.svelte';
	import { revive, uidOf, type BookAnnotations, type Rect } from './annotations.svelte';
	import { token } from './colors';
	import { annotatedCopy, cropOf, THUMBNAIL_WIDTH, type Box, type CopyEngine, type PageEngine } from './pdf';
	import { pageTexts, type TextEngine } from './text';
	import {
		between,
		centerOf,
		HANDLES,
		isRegion,
		moved,
		pagePoint,
		placement,
		resized,
		type Draft,
		type Handle,
		type Point,
		type Size
	} from './region';

	let {
		documentId,
		engine,
		annotations,
		onready
	}: {
		documentId: string;
		engine: PdfEngine;
		annotations: BookAnnotations;
		onready: (controls: ViewerControls) => void;
	} = $props();

	const annotation = useAnnotation(() => documentId);
	const tools = useAnnotationCapability();
	const selection = useSelectionCapability();
	const zoom = useZoom(() => documentId);
	const scroll = useScroll(() => documentId);
	const scrolling = useScrollCapability();
	const documentState = useDocumentState(() => documentId);
	const doc = $derived(documentState.current?.document ?? null);
	const accent = token('--accent');

	// The plugin's tools stay off: EmbedPDF's plain mode selects text and annotations; regions
	// are drawn by this component.
	type Mode = 'select' | 'region';
	let mode = $state<Mode>('select');
	/** The region drawn, waiting for Annotate (Create region only). Raw, as the selection below:
	 * the engine's worker receives its rect by postMessage (a reactive proxy cannot be cloned). */
	let draft = $state.raw<Draft | null>(null);
	function choose(next: Mode) {
		annotation.provides?.deselectAnnotation();
		selection.provides?.forDocument(documentId).clear();
		if (next === 'region') stopRetarget();
		draft = null;
		mode = next;
	}

	// A highlight waiting for its new text: the selection on its page when Annotate is clicked.
	let retarget = $state<{ row: BookAnnotation; done: (changed: boolean) => void } | null>(null);
	function stopRetarget() {
		retarget?.done(false);
		retarget = null;
	}

	// The text selection, as it ends (each page's part; [] while none or being made). EmbedPDF
	// draws it itself (the page is user-select: none), so the browser has none: Ctrl+C or the
	// menu of a right click copy `selectedText` ("" = none, or its text not read yet).
	let selectedParts = $state.raw<{ pageIndex: number; rect: Rect; segmentRects: Rect[] }[]>([]);
	let selectedText = $state('');
	let reading = 0;
	let selecting = false; // a selection shown (or being made)
	$effect(() => {
		const scope = selection.provides?.forDocument(documentId);
		if (!scope) return;
		const stopChange = scope.onSelectionChange((range) => {
			selecting = range !== null;
			reading++;
			selectedParts = [];
			selectedText = '';
		});
		const stopEnd = scope.onEndSelection(async () => {
			selectedParts = scope.getFormattedSelection();
			const mine = ++reading;
			const text = await scope
				.getSelectedText()
				.toPromise()
				.then((lines) => lines.join('\n'))
				.catch(() => '');
			if (mine === reading) selectedText = text; // else changed meanwhile
		});
		return () => {
			stopChange();
			stopEnd();
		};
	});

	/** What Annotate would do now (null: nothing, the button disabled). */
	const action = $derived.by(() => {
		if (mode === 'region') return draft ? 'region' : null;
		if (retarget) {
			const pageIndex = revive(retarget.row.target).pageIndex;
			return selectedParts.some((p) => p.pageIndex === pageIndex) ? 'retarget' : null;
		}
		return selectedParts.length ? 'highlight' : null;
	});

	/** The plugin's defaults for its tool (colours, widths: Viewer's config). */
	const defaults = (id: 'highlight' | 'square') => tools.provides?.getTool(id)?.defaults ?? {};
	const newAnnotation = (pageIndex: number, fields: object) => ({
		...fields,
		pageIndex,
		id: crypto.randomUUID(),
		created: new Date()
	});

	async function annotate() {
		const scope = selection.provides?.forDocument(documentId);
		const plugin = annotation.provides;
		const kind = action; // as it was clicked (the selection may change while its text is read)
		if (!scope || !plugin || !kind) return;
		if (kind === 'region' && draft) {
			const { pageIndex, rect } = draft;
			plugin.createAnnotation(pageIndex, newAnnotation(pageIndex, { ...defaults('square'), rect }) as never);
			draft = null;
			mode = 'select';
			return;
		}
		const parts = selectedParts;
		const waiting = retarget;
		const text = await scope
			.getSelectedText()
			.toPromise()
			.then((lines) => lines.join('\n'))
			.catch(() => undefined);
		const custom = text === undefined ? {} : { custom: { text } };
		if (kind === 'retarget' && waiting) {
			const target = revive(waiting.row.target);
			const chosen = parts.find((p) => p.pageIndex === target.pageIndex);
			if (!chosen) return;
			retarget = null;
			plugin.updateAnnotation(target.pageIndex, target.id, {
				rect: chosen.rect,
				segmentRects: chosen.segmentRects,
				...custom
			} as never);
			waiting.done(true);
		} else if (kind === 'highlight') {
			// One highlight per page (as the plugin's own tool), each with the whole text.
			for (const p of parts)
				plugin.createAnnotation(
					p.pageIndex,
					newAnnotation(p.pageIndex, {
						...defaults('highlight'),
						rect: p.rect,
						segmentRects: p.segmentRects,
						...custom
					}) as never
				);
		}
		scope.clear();
	}

	// Drawing the region: a drag on a page draws a new one (replacing the previous), its handles
	// resize it, its inside moves it. The pointer is captured by the page's layer meanwhile.
	let drag: {
		layer: HTMLElement;
		pageIndex: number;
		size: Size;
		from: Point;
		rect: Rect | null;
		handle: Handle | 'move' | 'draw';
	} | null = null;
	const sizeOf = (pageIndex: number): Size | null => doc?.pages[pageIndex]?.size ?? null;
	const pointOf = (e: PointerEvent, layer: HTMLElement, size: Size) =>
		pagePoint({ x: e.clientX, y: e.clientY }, layer.getBoundingClientRect(), size);
	function startDrag(e: PointerEvent, pageIndex: number, handle: Handle | 'move' | 'draw') {
		const layer = (e.target as HTMLElement).closest<HTMLElement>('.region-layer');
		const size = sizeOf(pageIndex);
		if (e.button !== 0 || !layer || !size) return;
		e.preventDefault();
		e.stopPropagation();
		layer.setPointerCapture(e.pointerId);
		const rect = handle === 'draw' ? null : (draft?.rect ?? null);
		drag = { layer, pageIndex, size, from: pointOf(e, layer, size), rect, handle };
	}
	function onDrag(e: PointerEvent) {
		if (!drag) return;
		const { layer, pageIndex, size, from, rect, handle } = drag;
		const p = pointOf(e, layer, size);
		if (handle === 'draw') {
			const drawn = between(from, p, size);
			if (isRegion(drawn)) draft = { pageIndex, rect: drawn }; // a click keeps the previous one
		} else if (rect && handle === 'move') {
			draft = { pageIndex, rect: moved(rect, p.x - from.x, p.y - from.y, size) };
		} else if (rect) {
			draft = { pageIndex, rect: resized(rect, handle as Handle, p, size) };
		}
	}
	function endDrag(e: PointerEvent) {
		if (!drag) return;
		if (drag.layer.hasPointerCapture(e.pointerId)) drag.layer.releasePointerCapture(e.pointerId);
		drag = null;
		if (draft && !isRegion(draft.rect)) draft = null; // squeezed to nothing by a handle
	}

	/** Scroll once the pages are laid out (to a point of the page: centred in the viewer): their first layout scrolls back to the top (EmbedPDF's
	 * setLayoutReady), and the page's first request (?page=, ?annotation=) comes as soon as the
	 * document is open, before it. onLayoutReady says it again to a new listener when it happened. */
	function scrollTo(pageNumber: number, behavior: 'smooth' | 'instant', point?: Point) {
		let done = false;
		const stop = scrolling.provides?.onLayoutReady((event) => {
			if (done || event.documentId !== documentId) return;
			done = true;
			queueMicrotask(() => stop?.()); // (said again at once: `stop` not set yet)
			scroll.provides?.scrollToPage(
				point ? { pageNumber, behavior, pageCoordinates: point, alignX: 50, alignY: 50 } : { pageNumber, behavior }
			);
		});
		if (stop) layoutWaits.push(stop);
	}
	// Listeners still waiting for the layout, stopped with the viewer.
	const layoutWaits: (() => void)[] = [];
	$effect(() => () => layoutWaits.forEach((stop) => stop()));

	let menu = $state<{ x: number; y: number } | null>(null);
	let menuElement = $state<HTMLElement>();
	let copyError = $state<string | null>(null);
	async function copy() {
		const text = selectedText;
		menu = null;
		copyError = null;
		await navigator.clipboard.writeText(text).catch(() => (copyError = t('books.viewer.copy_failed')));
	}
	const onPage = (e: Event) => e.target instanceof Element && e.target.closest('.page[data-page]') !== null;
	/** Before EmbedPDF's own listeners (window, capture phase): it clears its selection on any button's
	 * press, so the other buttons' never reach it over a page (a right click keeps the selection). A
	 * primary press over a page with a selection shown: cleared here first, as EmbedPDF's own clearing,
	 * during the press, makes the page take its pointer anew and lose that drag (each new selection
	 * would need a click first). */
	function primaryOnly(e: MouseEvent) {
		if (e.type.endsWith('down') && menu && !menuElement?.contains(e.target as Node)) menu = null;
		if (e.button !== 0 && onPage(e)) e.stopPropagation();
		else if (e.type === 'pointerdown' && selecting && mode === 'select' && onPage(e))
			selection.provides?.forDocument(documentId).clear();
	}
	function onContextMenu(e: MouseEvent) {
		if (!selectedText || !onPage(e)) return; // the browser's menu
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY };
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') menu = null;
		if (e.key === 'Escape' && mode === 'region' && !menu) draft = null;
		if (!selectedText || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'c') return;
		const field =
			e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input, textarea'));
		if (field || window.getSelection()?.toString()) return; // the browser copies its own selection
		e.preventDefault();
		copy();
	}
	// The menu inside the window, its item focused (Enter copies).
	$effect(() => {
		if (!menu || !menuElement) return;
		const { width, height } = menuElement.getBoundingClientRect();
		menuElement.style.left = `${Math.max(0, Math.min(menu.x, innerWidth - width))}px`;
		menuElement.style.top = `${Math.max(0, Math.min(menu.y, innerHeight - height))}px`;
		menuElement.querySelector('button')?.focus();
	});

	// The plugin's selection → the panel's (the panel's goes back through select()).
	$effect(() => {
		const uid = annotation.state.selectedUid;
		if (uid && annotations.rows.some((r) => uidOf(r) === uid)) annotations.selectedUid = uid;
	});

	$effect(() => {
		// A plain copy: the engine's worker receives it by postMessage (a reactive proxy cannot be cloned).
		const d = doc && $state.snapshot(doc);
		const pageEngine = engine as unknown as PageEngine;
		if (!d) return;
		onready({
			select(row) {
				const target = revive(row.target);
				scrollTo(target.pageIndex + 1, 'smooth', centerOf(target.rect)); // the annotation itself in view
				annotation.provides?.selectAnnotation(target.pageIndex, target.id);
				annotations.selectedUid = target.id;
			},
			remove(row) {
				const target = revive(row.target);
				annotation.provides?.deleteAnnotation(target.pageIndex, target.id);
			},
			recolor(row, color) {
				// Both kinds are drawn in their strokeColor (a highlight's `color` is deprecated: never drawn).
				const target = revive(row.target);
				annotation.provides?.updateAnnotation(target.pageIndex, target.id, { strokeColor: color });
			},
			reselect(row) {
				stopRetarget();
				choose('select');
				const target = revive(row.target);
				scrollTo(target.pageIndex + 1, 'smooth', centerOf(target.rect));
				return new Promise((done) => (retarget = { row, done }));
			},
			cancelReselect: stopRetarget,
			crop: (pageIndex, rect) => cropOf(pageEngine, d, pageIndex, rect),
			pageTexts: () => pageTexts(engine as unknown as TextEngine, d),
			showPage(page) {
				scrollTo(page, 'instant');
			},
			annotatedCopy: (pdf, list) => annotatedCopy(engine as unknown as CopyEngine, pdf, list),
			async firstPage() {
				const page = d.pages[0];
				if (!page) return null;
				const options = { scaleFactor: THUMBNAIL_WIDTH / page.size.width, imageType: 'image/jpeg' as const };
				return engine
					.renderPage(d, page, { ...options, imageQuality: 0.85 })
					.toPromise()
					.catch(() => null);
			}
		});
	});
</script>

<svelte:window
	onpointerdowncapture={primaryOnly}
	onmousedowncapture={primaryOnly}
	onpointerupcapture={primaryOnly}
	onmouseupcapture={primaryOnly}
	oncontextmenu={onContextMenu}
	onkeydown={onKeydown}
	onwheel={() => (menu = null)}
	onresize={() => (menu = null)}
	onblur={() => (menu = null)}
/>

{#if menu}
	<div class="menu" role="menu" bind:this={menuElement}>
		<button type="button" role="menuitem" onclick={copy}>{t('books.viewer.copy')}</button>
	</div>
{/if}

<div class="toolbar" role="toolbar" aria-label={t('books.viewer.tools')}>
	<div class="group">
		<button type="button" class="secondary" aria-pressed={mode === 'select'} onclick={() => choose('select')}>
			{t('books.viewer.tool.select')}
		</button>
		<button type="button" class="secondary" aria-pressed={mode === 'region'} onclick={() => choose('region')}>
			{t('books.viewer.tool.region')}
		</button>
		<button type="button" disabled={!action} onclick={annotate}>{t('books.viewer.annotate')}</button>
	</div>
	<div class="group">
		<button
			type="button"
			class="secondary"
			aria-label={t('books.viewer.zoom_out')}
			onclick={() => zoom.provides?.zoomOut()}>−</button
		>
		<span class="hint">{Math.round((zoom.state.currentZoomLevel ?? 1) * 100)} %</span>
		<button
			type="button"
			class="secondary"
			aria-label={t('books.viewer.zoom_in')}
			onclick={() => zoom.provides?.zoomIn()}>+</button
		>
		<span class="hint" role="status">
			{t('books.viewer.page', { n: scroll.state.currentPage, total: scroll.state.totalPages })}
		</span>
	</div>
</div>
<ErrorMessage error={copyError} />

{#snippet renderPage(page: { pageIndex: number; width: number; height: number })}
	<div class="page" style:width="{page.width}px" style:height="{page.height}px" data-page={page.pageIndex + 1}>
		<PagePointerProvider {documentId} pageIndex={page.pageIndex}>
			<!-- No pointer on the page's picture: dragging an image starts the browser's own drag,
			     which cancels the pointer (as EmbedPDF's examples do). -->
			<RenderLayer {documentId} pageIndex={page.pageIndex} class="render" />
			<SelectionLayer {documentId} pageIndex={page.pageIndex} />
			<AnnotationLayer
				{documentId}
				pageIndex={page.pageIndex}
				resizeUI={{ size: 10, color: accent }}
				vertexUI={{ size: 10, color: accent }}
				selectionOutline={{ color: accent, style: 'solid', width: 2, offset: 2 }}
			/>
		</PagePointerProvider>
		{#if mode === 'region'}
			<!-- Over the page's own layers: a drag here draws, never selects. -->
			<div
				class="region-layer"
				role="presentation"
				onpointerdown={(e) => startDrag(e, page.pageIndex, 'draw')}
				onpointermove={onDrag}
				onpointerup={endDrag}
				onpointercancel={endDrag}
			>
				{#if draft?.pageIndex === page.pageIndex}
					{@const size = sizeOf(page.pageIndex)}
					{#if size}
						{@const at = placement(draft.rect, size)}
						<div
							class="draft"
							role="presentation"
							data-region-draft
							style:left={at.left}
							style:top={at.top}
							style:width={at.width}
							style:height={at.height}
							onpointerdown={(e) => startDrag(e, page.pageIndex, 'move')}
						>
							{#each HANDLES as handle (handle)}
								<span
									class="handle {handle}"
									data-handle={handle}
									role="presentation"
									onpointerdown={(e) => startDrag(e, page.pageIndex, handle)}
								></span>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

<!-- While a highlight waits for its new text, the pointer goes to the text, not the annotations. -->
<Viewport {documentId} class="viewport{retarget ? ' choosing-text' : ''}">
	<Scroller {documentId} {renderPage} />
</Viewport>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) 0;
	}
	.group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}
	.menu {
		position: fixed;
		z-index: 10;
		min-width: 8rem;
		display: grid;
		padding: var(--space-1);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-menu);
	}
	.menu button {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-weight: normal;
		text-align: left;
		color: var(--text);
		background: none;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.menu button:hover,
	.menu button:focus-visible {
		background: var(--bg);
	}
	button[aria-pressed='true'] {
		color: var(--accent-text);
		background: var(--accent);
		border-color: var(--accent);
	}
	:global(.viewport) {
		flex: 1;
		min-height: 0;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	/* Its own elements set pointer-events themselves: all of them, while choosing. */
	:global(.choosing-text #annotation-layer),
	:global(.choosing-text #annotation-layer *) {
		pointer-events: none !important;
	}
	.page :global(.render) {
		pointer-events: none;
	}
	.region-layer {
		position: absolute;
		inset: 0;
		z-index: 1;
		cursor: crosshair;
		touch-action: none;
	}
	/* The region drawn: its outline, its handles centred on its corners and edges. */
	.draft {
		--handle: var(--space-3);
		--half: calc(var(--handle) / -2);
		position: absolute;
		box-sizing: border-box;
		border: 2px dashed var(--accent);
		cursor: move;
	}
	.handle {
		position: absolute;
		width: var(--handle);
		height: var(--handle);
		background: var(--surface);
		border: 2px solid var(--accent);
		border-radius: var(--radius-xs);
	}
	.nw,
	.n,
	.ne {
		top: var(--half);
	}
	.sw,
	.s,
	.se {
		bottom: var(--half);
	}
	.nw,
	.w,
	.sw {
		left: var(--half);
	}
	.ne,
	.e,
	.se {
		right: var(--half);
	}
	.n,
	.s {
		left: calc(50% + var(--half));
		cursor: ns-resize;
	}
	.e,
	.w {
		top: calc(50% + var(--half));
		cursor: ew-resize;
	}
	.nw,
	.se {
		cursor: nwse-resize;
	}
	.ne,
	.sw {
		cursor: nesw-resize;
	}
	/* The browser selects nothing itself: EmbedPDF draws its own text selection, and a
	   native selection of the page would interrupt its drags. */
	.page {
		position: relative;
		background: var(--media-bg);
		user-select: none;
		-webkit-user-select: none;
	}
</style>
