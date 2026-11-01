<script lang="ts">
	// A range between two bounds: two sliders on one track (the low end can't pass the
	// high one), the chosen values shown above them. Whole steps. Named by the parent
	// (a fieldset's legend), each slider by its own label.
	import type { Range } from './videos/filter';

	let {
		min,
		max,
		value = $bindable(),
		format = String,
		lowLabel,
		highLabel
	}: {
		min: number;
		max: number;
		value: Range;
		format?: (n: number) => string;
		lowLabel: string; // each slider's
		highLabel: string;
	} = $props();

	const fixed = $derived(min >= max); // one value only: nothing to choose
	const percent = (n: number) => (fixed ? 0 : ((n - min) / (max - min)) * 100);
	const low = $derived(Math.max(min, Math.min(value[0], max)));
	const high = $derived(Math.min(max, Math.max(value[1], min)));

	function setLow(e: Event) {
		value = [Math.min(Number((e.currentTarget as HTMLInputElement).value), high), high];
	}
	function setHigh(e: Event) {
		value = [low, Math.max(Number((e.currentTarget as HTMLInputElement).value), low)];
	}
</script>

<div class="range">
	<div class="values">
		<span>{format(low)}</span>
		<span>{format(high)}</span>
	</div>
	<div class="track" style="--from: {percent(low)}%; --to: {percent(high)}%">
		<!-- The low handle on top in the upper half: both at the top end, it can still be moved down. -->
		<input
			type="range"
			{min}
			{max}
			step="1"
			value={low}
			disabled={fixed}
			aria-label={lowLabel}
			aria-valuetext={format(low)}
			style:z-index={percent(low) > 50 ? 2 : undefined}
			oninput={setLow}
		/>
		<input
			type="range"
			{min}
			{max}
			step="1"
			value={high}
			disabled={fixed}
			aria-label={highLabel}
			aria-valuetext={format(high)}
			oninput={setHigh}
		/>
	</div>
</div>

<style>
	.range {
		display: grid;
		gap: var(--space-1);
	}
	.values {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	/* Both sliders on the same line; the bar between the handles in the accent colour. */
	.track {
		--thumb: 1.1rem;
		position: relative;
		height: var(--thumb);
	}
	.track::before {
		content: '';
		position: absolute;
		top: calc(50% - var(--space-0));
		height: var(--space-1);
		left: 0;
		right: 0;
		border-radius: var(--radius-pill);
		background: linear-gradient(
			to right,
			var(--border) var(--from),
			var(--accent) var(--from),
			var(--accent) var(--to),
			var(--border) var(--to)
		);
	}
	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: var(--thumb);
		margin: 0;
		padding: 0;
		background: transparent;
		border: none;
		appearance: none;
		pointer-events: none; /* only the handles take the pointer: both can be reached */
		z-index: 1; /* the high handle above the low one (later), but in the upper half */
	}
	input::-webkit-slider-runnable-track {
		background: transparent;
	}
	input::-moz-range-track {
		background: transparent;
	}
	input::-webkit-slider-thumb {
		appearance: none;
		width: var(--thumb);
		height: var(--thumb);
		border-radius: 50%;
		background: var(--surface);
		border: 2px solid var(--accent);
		pointer-events: auto;
		cursor: pointer;
	}
	input::-moz-range-thumb {
		width: var(--thumb);
		height: var(--thumb);
		box-sizing: border-box;
		border-radius: 50%;
		background: var(--surface);
		border: 2px solid var(--accent);
		pointer-events: auto;
		cursor: pointer;
	}
	input:disabled::-webkit-slider-thumb {
		border-color: var(--border);
		cursor: default;
	}
	input:disabled::-moz-range-thumb {
		border-color: var(--border);
		cursor: default;
	}
</style>
