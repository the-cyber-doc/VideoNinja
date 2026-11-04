<script lang="ts">
	// Over one page while a tool is chosen: the box the user drags (pointer events, captured
	// until released), given back in PDF points. The page's scale: its width on screen over
	// its width in points. Small boxes (a click) are ignored.
	import type { Box } from './pdf';

	let { width, pointsWide, ondraw }: { width: number; pointsWide: number; ondraw: (area: Box) => void } = $props();

	const MIN_PX = 6;
	let start = $state<{ x: number; y: number } | null>(null);
	let end = $state<{ x: number; y: number } | null>(null);
	const box = $derived(
		start && end
			? {
					left: Math.min(start.x, end.x),
					top: Math.min(start.y, end.y),
					width: Math.abs(end.x - start.x),
					height: Math.abs(end.y - start.y)
				}
			: null
	);

	const at = (e: PointerEvent) => {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};

	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		start = end = at(e);
	}
	function move(e: PointerEvent) {
		if (start) end = at(e);
	}
	function up(e: PointerEvent) {
		if (!start) return;
		end = at(e);
		const drawn = box;
		start = end = null;
		if (!drawn || (drawn.width < MIN_PX && drawn.height < MIN_PX)) return;
		const scale = width / pointsWide;
		ondraw({
			origin: { x: drawn.left / scale, y: drawn.top / scale },
			size: { width: drawn.width / scale, height: drawn.height / scale }
		});
	}
</script>

<div
	class="draw"
	role="presentation"
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={() => (start = end = null)}
>
	{#if box}
		<div
			class="box"
			style:left="{box.left}px"
			style:top="{box.top}px"
			style:width="{box.width}px"
			style:height="{box.height}px"
		></div>
	{/if}
</div>

<style>
	.draw {
		position: absolute;
		inset: 0;
		z-index: 20;
		cursor: crosshair;
		touch-action: none;
	}
	.box {
		position: absolute;
		border: 2px dashed var(--accent);
	}
</style>
