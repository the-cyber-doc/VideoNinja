<script lang="ts">
	// Inline SVG icons (24×24, stroke = currentColor). Decorative: the button or
	// element around the icon carries the accessible name.
	const PATHS = {
		user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
		copy: 'M9 9h10v10H9zM5 15V5h10',
		refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
		check: 'M5 12.5l4.5 4.5L19 7',
		cross: 'M6 6l12 12M18 6L6 18',
		'user-off': 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 12-4.9M16 16l5 5M21 16l-5 5',
		trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
		play: 'M7 5v14l12-7z',
		pause: 'M8 5v14M16 5v14',
		stop: 'M6 6h12v12H6z',
		'frame-back': 'M17 6v12l-9-6zM7 6v12',
		'frame-forward': 'M7 6v12l9-6zM17 6v12',
		'chevron-down': 'M6 9l6 6 6-6',
		filter: 'M4 5h16l-6 7.5V19l-4-2v-4.5z',
		link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
		cloud: 'M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.7 3.7 0 0 1 17.5 18Z',
		phone:
			'M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5ZM11 18.5h2'
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
