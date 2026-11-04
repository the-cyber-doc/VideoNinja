<script lang="ts">
	// A book's PDF, shown and annotated with EmbedPDF (PDFium in WebAssembly, served by the
	// app; no font fetched from elsewhere). The document is the browser's copy: annotations
	// change it in memory only (the server's file is never written); ViewerPages saves each
	// change through `annotations` (BookAnnotations). Read-only PDFs (permissions) can be
	// annotated too: the copy is ours. The engine runs in the page: a worker made from a
	// blob: URL is refused by the app's Content-Security-Policy, kept as it is.
	import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
	import { createPluginRegistration } from '@embedpdf/core';
	import { EmbedPDF } from '@embedpdf/core/svelte';
	import { usePdfiumEngine } from '@embedpdf/engines/svelte';
	import { AnnotationPlugin, AnnotationPluginPackage } from '@embedpdf/plugin-annotation/svelte';
	import type { PluginRegistry } from '@embedpdf/core';
	import { onDestroy } from 'svelte';
	import { DocumentContent, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/svelte';
	import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager/svelte';
	import { RenderPluginPackage } from '@embedpdf/plugin-render/svelte';
	import { ScrollPluginPackage } from '@embedpdf/plugin-scroll/svelte';
	import { SelectionPluginPackage } from '@embedpdf/plugin-selection/svelte';
	import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/svelte';
	import { ZoomMode, ZoomPluginPackage } from '@embedpdf/plugin-zoom/svelte';
	import ErrorMessage from '../ErrorMessage.svelte';
	import { t } from '../i18n.svelte';
	import type { BookAnnotations } from './annotations.svelte';
	import ViewerPages, { type ViewerControls } from './ViewerPages.svelte';

	let {
		pdf,
		name,
		author,
		annotations,
		onready
	}: {
		pdf: ArrayBuffer;
		name: string;
		/** Written into each new annotation (the user's display name). */
		author: string;
		annotations: BookAnnotations;
		onready: (controls: ViewerControls) => void;
	} = $props();

	// In the page (not a worker from a blob: URL, which the app's CSP refuses).
	const pdfEngine = usePdfiumEngine({ wasmUrl, fontFallback: null, worker: false });
	// The document and the author are the ones the page opened with.
	// svelte-ignore state_referenced_locally
	const plugins = [
		createPluginRegistration(DocumentManagerPluginPackage, {
			initialDocuments: [{ buffer: pdf, name, documentId: 'book', permissions: { enforceDocumentPermissions: false } }]
		}),
		createPluginRegistration(ViewportPluginPackage),
		createPluginRegistration(ScrollPluginPackage),
		createPluginRegistration(RenderPluginPackage),
		createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
		createPluginRegistration(InteractionManagerPluginPackage),
		createPluginRegistration(SelectionPluginPackage),
		createPluginRegistration(AnnotationPluginPackage, {
			annotationAuthor: author,
			autoCommit: true,
			deactivateToolAfterCreate: true,
			// The panel selects a new annotation itself; the plugin's selection would make the
			// next drag only deselect it.
			selectAfterCreate: false
		})
	];

	// Once per viewer (its inside may mount again): the saved annotations in, every
	// committed change out to `annotations`.
	let disconnect = () => {};
	async function connect(registry: PluginRegistry) {
		const scope = registry.getPlugin<AnnotationPlugin>(AnnotationPlugin.id)?.provides().forDocument('book');
		if (!scope) return;
		scope.importAnnotations(annotations.items() as never);
		disconnect = scope.onAnnotationEvent((event) => annotations.handle(event as never));
	}
	onDestroy(() => disconnect());
</script>

<div class="viewer">
	{#if pdfEngine.error}
		<ErrorMessage error={t('books.viewer.engine_failed')} />
	{:else if pdfEngine.isLoading || !pdfEngine.engine}
		<p class="hint" role="status">{t('books.viewer.loading')}</p>
	{:else}
		<EmbedPDF engine={pdfEngine.engine} {plugins} onInitialized={connect} autoMountDomElements={false}>
			<!-- The active document from the core state: EmbedPDF sets its activeDocumentId shortcut
			     only on later changes, and ours became active while it started. -->
			{#snippet children(context)}
				{@const active = context.activeDocumentId ?? context.coreState?.activeDocumentId}
				{#if active && context.pluginsReady}
					{@const documentId = active}
					<DocumentContent {documentId}>
						{#snippet children(content)}
							{#if content.isLoaded}
								<ViewerPages {documentId} engine={pdfEngine.engine!} {annotations} {onready} />
							{:else if content.isError}
								<ErrorMessage error={t('books.viewer.unreadable')} />
							{:else}
								<p class="hint" role="status">{t('books.viewer.loading')}</p>
							{/if}
						{/snippet}
					</DocumentContent>
				{/if}
			{/snippet}
		</EmbedPDF>
	{/if}
</div>

<style>
	/* The toolbar, then the pages filling the rest (the viewport needs a height). */
	.viewer {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
	}
</style>
