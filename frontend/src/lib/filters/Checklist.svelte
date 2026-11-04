<script lang="ts" generics="V">
	// Checkboxes, one per value offered: the values checked (OR between them); none checked:
	// any value. In a filter pane.
	let {
		legend,
		items,
		selected = $bindable()
	}: { legend: string; items: { value: V; label: string }[]; selected: V[] } = $props();

	function toggle(value: V, on: boolean) {
		selected = on ? [...selected.filter((x) => x !== value), value] : selected.filter((x) => x !== value);
	}
</script>

<fieldset>
	<legend>{legend}</legend>
	<div class="choices">
		{#each items as item (item.value)}
			<label class="check">
				<input
					type="checkbox"
					checked={selected.includes(item.value)}
					onchange={(e) => toggle(item.value, e.currentTarget.checked)}
				/>
				{item.label}
			</label>
		{/each}
	</div>
</fieldset>
