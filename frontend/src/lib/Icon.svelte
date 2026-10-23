<script lang="ts">
	// Inline SVG icons (24×24, stroke = currentColor). Decorative: the button or
	// element around the icon carries the accessible name.
	const PATHS = {
		user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
		copy: 'M9 9h10v10H9zM5 15V5h10',
		refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
		check: 'M5 12.5l4.5 4.5L19 7',
		cross: 'M6 6l12 12M18 6L6 18',
		play: 'M7 5v14l12-7z',
		pause: 'M8 5v14M16 5v14',
		stop: 'M6 6h12v12H6z',
		'frame-back': 'M17 6v12l-9-6zM7 6v12',
		'frame-forward': 'M7 6v12l9-6zM17 6v12'
	};

	let { name, size = 20 }: { name: keyof typeof PATHS; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d={PATHS[name]} />
</svg>
