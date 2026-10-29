<script lang="ts">
	// Annotating a published video again: the upload's annotation panel, with the
	// video from the server and its saved segments and tags. Proceed saves them
	// (nothing is uploaded). Needs the "video_mgmt" access.
	import ErrorMessage from '#lib/ErrorMessage.svelte';
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { url } from '#lib/base.js';
	import { loadCatalog, type Catalog } from '#lib/catalog.svelte.js';
	import { i18n, t } from '#lib/i18n.svelte.js';
	import { saveVideo } from '#lib/offline.svelte.js';
	import { hasAccess } from '#lib/session.svelte.js';
	import AnnotationPanel from '#lib/upload/AnnotationPanel.svelte';
	import { addPerformer, listPerformers as loadPerformers } from '#lib/api/performers.js';
	import { listTags as loadTags } from '#lib/api/tags.js';
	import type { Performer, Tag } from '#lib/api/types.js';
	import type { Annotation } from '#lib/upload/draft.svelte.js';
	import { getAnnotations, saveAnnotations } from '#lib/api/videos.js';
	import { videoUrl } from '#lib/media.js';
	import { toAnnotation, toAnnotations } from '#lib/videos/annotations.js';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const id = $derived(Number(params.id));
	const allowed = $derived(hasAccess('video_mgmt'));

	let catalog = $state<Catalog | null>(null);
	let annotation = $state<Annotation | null>(null);
	let about = $state({ filename: '', uploadedBy: null as string | null });
	let saved = ''; // the annotation as loaded or last saved: unsaved changes ask before leaving
	let performers = $state<Performer[]>([]);
	let tags = $state<Tag[]>([]);
	let saving = $state(false);
	let error = $state<unknown>(null);

	$effect(() => {
		if (!allowed) {
			goto(url('/'), { replace: true });
			return;
		}
		const video = id;
		saveVideo(videoUrl(video)); // on the device for next time (the editor reads it from the network now)
		// Untracked: a language change or a newer catalogue must not reload the
		// video and lose the changes in progress; only another video does.
		untrack(() =>
			Promise.all([loadCatalog(), getAnnotations(video)]).then(
				([c, a]) => {
					catalog = c;
					about = { filename: a.original_filename, uploadedBy: a.uploaded_by };
					annotation = toAnnotation(a, c);
					saved = JSON.stringify(annotation);
				},
				(e) => (error = e)
			)
		);
		loadPerformers().then(
			(list) => (performers = list),
			(e) => (error = e)
		);
	});

	$effect(() => {
		if (!allowed) return;
		void i18n.lang; // tag names are translated by the server
		loadTags().then(
			(list) => (tags = list),
			(e) => (error = e)
		);
	});

	const changed = () => !!annotation && JSON.stringify(annotation) !== saved;

	beforeNavigate(({ cancel, willUnload }) => {
		if (!saving && changed() && !willUnload && !confirm(t('videos.leave_confirm'))) cancel();
	});

	async function newPerformer(name: string) {
		const performer = await addPerformer(name);
		performers = [...performers, performer];
		return performer;
	}

	async function proceed() {
		if (!annotation) return;
		saving = true;
		error = null;
		try {
			await saveAnnotations(id, toAnnotations(annotation));
			saved = JSON.stringify(annotation);
			await goto(url('/videos?saved'));
		} catch (e) {
			error = e;
		} finally {
			saving = false;
		}
	}
</script>

<svelte:window onbeforeunload={(e) => changed() && e.preventDefault()} />

{#if allowed}
	<div class="page">
		<a class="back" href={url('/videos')}>← {t('videos.back')}</a>
		<ErrorMessage {error} />
		{#if annotation && catalog}
			<AnnotationPanel
				src={videoUrl(id)}
				filename={about.filename}
				uploadedBy={about.uploadedBy}
				bind:annotation
				{catalog}
				{performers}
				{tags}
				busy={saving}
				onaddperformer={newPerformer}
				onproceed={proceed}
				oncancel={() => goto(url('/videos'))}
			>
				{#if saving}<p class="hint" role="status">{t('videos.saving')}</p>{/if}
			</AnnotationPanel>
		{:else if !error}
			<p class="hint centered">{t('common.loading')}</p>
		{/if}
	</div>
{/if}

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
		display: grid;
		gap: var(--space-4);
	}
	.back {
		justify-self: start;
	}
</style>
