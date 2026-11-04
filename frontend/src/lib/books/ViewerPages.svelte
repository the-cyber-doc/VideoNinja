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
		crop(pageIndex: number, rect: Box): Promise<Blob | null>;
		/** Page 1 as the book's thumbnail (null: not rendered). */
		firstPage(): Promise<Blob | null>;
		/** A copy of the PDF (as uploaded) with these annotations written in it. */
		annotatedCopy(pdf: ArrayBuffer, annotations: { pageIndex: number }[]): Promise<ArrayBuffer>;
	}
</script>

<script lang="ts">
	// The viewer's inside (EmbedPDF's context): the plugin's tools (select, highlight text,
	// mark a region), zoom, the pages with their text selection and annotation layers. The
	// plugin's committed changes are saved by Viewer (BookAnnotations); its selection and
	// the panel's follow each other.
	import type { PdfEngine } from '@embedpdf/models';
	import { useDocumentState } from '@embedpdf/core/svelte';
	import { AnnotationLayer, useAnnotation } from '@embedpdf/plugin-annotation/svelte';
	import { PagePointerProvider } from '@embedpdf/plugin-interaction-manager/svelte';
	import { RenderLayer } from '@embedpdf/plugin-render/svelte';
	import { Scroller, useScroll } from '@embedpdf/plugin-scroll/svelte';
	import { Viewport } from '@embedpdf/plugin-viewport/svelte';
	import { SelectionLayer } from '@embedpdf/plugin-selection/svelte';
	import { useZoom } from '@embedpdf/plugin-zoom/svelte';
	import { t } from '../i18n.svelte';
	import { revive, SQUARE, uidOf, type BookAnnotations } from './annotations.svelte';
	import { token } from './colors';
	import { annotatedCopy, cropOf, THUMBNAIL_WIDTH, type Box, type CopyEngine, type PageEngine } from './pdf';

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
	const zoom = useZoom(() => documentId);
	const scroll = useScroll(() => documentId);
	const documentState = useDocumentState(() => documentId);
	const doc = $derived(documentState.current?.document ?? null);
	const accent = token('--accent');

	const TOOLS = [
		{ id: null, label: 'books.viewer.tool.select' },
		{ id: 'highlight', label: 'books.viewer.tool.highlight' },
		{ id: 'square', label: 'books.viewer.tool.region' }
	] as const;
	/** A tool chosen: nothing stays selected (a drag over a page would only deselect it). */
	function choose(id: (typeof TOOLS)[number]['id']) {
		annotation.provides?.deselectAnnotation();
		annotation.provides?.setActiveTool(id);
	}

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
			crop: (pageIndex, rect) => cropOf(pageEngine, d, pageIndex, rect),
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

<div class="toolbar" role="toolbar" aria-label={t('books.viewer.tools')}>
	<div class="group">
		{#each TOOLS as choice (choice.label)}
			<button
				type="button"
				class="secondary"
				aria-pressed={annotation.state.activeToolId === choice.id}
				onclick={() => choose(choice.id)}
			>
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
	.page :global(.render) {
		pointer-events: none;
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
