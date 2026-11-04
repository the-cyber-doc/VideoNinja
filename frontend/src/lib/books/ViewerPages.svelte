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
		quote(pageIndex: number, rects: Box[]): Promise<string | null>;
		crop(pageIndex: number, rect: Box): Promise<Blob | null>;
		/** Page 1 as the book's thumbnail (null: not rendered). */
		firstPage(): Promise<Blob | null>;
	}
</script>

<script lang="ts">
	// The viewer's inside (EmbedPDF's context): the tools, zoom, the pages with their
	// annotation layers. The two tools draw a box over a page (DrawLayer, our own pointer
	// handling: the plugin's drag tools lose their drag here): "highlight" keeps the text
	// in it, one rectangle per line; "region" is the box itself. Either becomes a PDF
	// annotation through the plugin, which commits it (Viewer saves the commits); the
	// plugin's selection and the panel's follow each other.
	import type { PdfEngine } from '@embedpdf/models';
	import { useDocumentState } from '@embedpdf/core/svelte';
	import { AnnotationLayer, useAnnotation } from '@embedpdf/plugin-annotation/svelte';
	import { PagePointerProvider } from '@embedpdf/plugin-interaction-manager/svelte';
	import { RenderLayer } from '@embedpdf/plugin-render/svelte';
	import { Scroller, useScroll } from '@embedpdf/plugin-scroll/svelte';
	import { Viewport } from '@embedpdf/plugin-viewport/svelte';
	import { useZoom } from '@embedpdf/plugin-zoom/svelte';
	import { t } from '../i18n.svelte';
	import { HIGHLIGHT, revive, SQUARE, uidOf, type BookAnnotations } from './annotations.svelte';
	import { ANNOTATION_COLORS, token } from './colors';
	import DrawLayer from './DrawLayer.svelte';
	import { around, cropOf, quoteOf, textRects, THUMBNAIL_WIDTH, type Box, type PageEngine } from './pdf';

	let {
		documentId,
		engine,
		annotations,
		author,
		onready
	}: {
		documentId: string;
		engine: PdfEngine;
		annotations: BookAnnotations;
		/** Written into each new annotation. */
		author: string;
		onready: (controls: ViewerControls) => void;
	} = $props();

	const annotation = useAnnotation(() => documentId);
	const zoom = useZoom(() => documentId);
	const scroll = useScroll(() => documentId);
	const documentState = useDocumentState(() => documentId);
	const doc = $derived(documentState.current?.document ?? null);
	const accent = token('--accent');

	const TOOLS = [
		{ id: null, label: 'books.viewer.tool.select' },
		{ id: 'highlight', label: 'books.viewer.tool.highlight' },
		{ id: 'region', label: 'books.viewer.tool.region' }
	] as const;
	let tool = $state<(typeof TOOLS)[number]['id']>(null);

	/** A box drawn on a page: a highlight of its text, or a region; the tool is done. */
	async function drawn(pageIndex: number, area: Box) {
		const d = doc;
		const plugin = annotation.provides;
		const chosen = tool;
		tool = null;
		if (!d || !plugin || !chosen) return;
		const common = { id: crypto.randomUUID(), pageIndex, author, created: new Date(), flags: ['print'] as const };
		if (chosen === 'region') {
			plugin.createAnnotation(pageIndex, {
				...common,
				type: SQUARE,
				rect: area,
				color: 'transparent',
				strokeColor: ANNOTATION_COLORS.at(-1)!.value,
				strokeWidth: 2,
				opacity: 1
			} as never);
			return;
		}
		const lines = await textRects(engine as unknown as PageEngine, d, pageIndex, area);
		if (!lines.length) return; // no text there (a scan: mark a region)
		plugin.createAnnotation(pageIndex, {
			...common,
			type: HIGHLIGHT,
			rect: around(lines),
			segmentRects: lines,
			color: ANNOTATION_COLORS[0].value,
			opacity: 0.5
		} as never);
	}

	// The plugin's selection → the panel's (the panel's goes back through select()).
	$effect(() => {
		const uid = annotation.state.selectedUid;
		if (uid && annotations.rows.some((r) => uidOf(r) === uid)) annotations.selectedUid = uid;
	});

	$effect(() => {
		const d = doc;
		const pageEngine = engine as unknown as PageEngine;
		if (!d) return;
		onready({
			select(row) {
				const target = revive(row.target);
				scroll.provides?.scrollToPage({ pageNumber: row.page, behavior: 'smooth' });
				annotation.provides?.selectAnnotation(target.pageIndex, target.id);
				annotations.selectedUid = target.id;
			},
			remove(row) {
				const target = revive(row.target);
				annotation.provides?.deleteAnnotation(target.pageIndex, target.id);
			},
			recolor(row, color) {
				const target = revive(row.target);
				const patch = target.type === SQUARE ? { strokeColor: color } : { color };
				annotation.provides?.updateAnnotation(target.pageIndex, target.id, patch);
			},
			quote: (pageIndex, rects) => quoteOf(pageEngine, d, pageIndex, rects),
			crop: (pageIndex, rect) => cropOf(pageEngine, d, pageIndex, rect),
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

<div class="toolbar" role="toolbar" aria-label={t('books.viewer.tools')}>
	<div class="group">
		{#each TOOLS as choice (choice.label)}
			<button type="button" class="secondary" aria-pressed={tool === choice.id} onclick={() => (tool = choice.id)}>
				{t(choice.label)}
			</button>
		{/each}
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

{#snippet renderPage(page: { pageIndex: number; width: number; height: number })}
	<div class="page" style:width="{page.width}px" style:height="{page.height}px" data-page={page.pageIndex + 1}>
		<PagePointerProvider {documentId} pageIndex={page.pageIndex}>
			<RenderLayer {documentId} pageIndex={page.pageIndex} />
			{#if tool && doc?.pages[page.pageIndex]}
				<DrawLayer
					width={page.width}
					pointsWide={doc.pages[page.pageIndex].size.width}
					ondraw={(area) => drawn(page.pageIndex, area)}
				/>
			{/if}
			<AnnotationLayer
				{documentId}
				pageIndex={page.pageIndex}
				resizeUI={{ size: 10, color: accent }}
				vertexUI={{ size: 10, color: accent }}
				selectionOutline={{ color: accent, style: 'solid', width: 2, offset: 2 }}
			/>
		</PagePointerProvider>
	</div>
{/snippet}

<Viewport {documentId} class="viewport">
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
	.page {
		position: relative;
		background: var(--media-bg);
	}
</style>
