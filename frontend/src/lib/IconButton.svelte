<script lang="ts">
	// A button that shows only an icon: its label is given once and becomes both its
	// accessible name (aria-label) and its tooltip (title).
	//   variant 'outlined' (default): a square with a border (player, editor, lists);
	//           'quiet': no border, muted (remove a segment, a tag).
	//   size 'sm' 2rem, 'md' 2.2rem (default), 'lg' 2.4rem; round: a circle.
	// A class given here can only be styled by the parent through :global(.name).
	import type { ComponentProps, Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	type Props = Omit<HTMLButtonAttributes, 'title' | 'aria-label' | 'children'> & {
		label: string;
		icon: ComponentProps<typeof Icon>['name'];
		iconSize?: number;
		variant?: 'outlined' | 'quiet';
		size?: 'sm' | 'md' | 'lg';
		round?: boolean;
		children?: Snippet;
	};
	let {
		label,
		icon,
		iconSize,
		variant = 'outlined',
		size = 'md',
		round = false,
		type = 'button',
		class: className = '',
		...rest
	}: Props = $props();
</script>

<button {type} title={label} aria-label={label} class="{variant} {size} {className}" class:round {...rest}>
	<Icon name={icon} size={iconSize} />
</button>

<style>
	button {
		display: inline-grid;
		place-items: center;
		padding: 0;
		color: var(--text);
		background: transparent;
	}
	.outlined {
		border: 1px solid var(--border);
	}
	.outlined.sm {
		width: 2rem;
		height: 2rem;
	}
	.outlined.md {
		width: 2.2rem;
		height: 2.2rem;
	}
	.outlined.lg {
		width: 2.4rem;
		height: 2.4rem;
	}
	.quiet {
		padding: var(--space-1);
		color: var(--muted);
	}
	.quiet.sm {
		padding: var(--space-0);
	}
	.round {
		border-radius: 50%;
	}
</style>
