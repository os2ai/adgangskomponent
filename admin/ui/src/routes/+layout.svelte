<script>
	let { children } = $props();
</script>

<svelte:head>
	<link rel="stylesheet" type="text/css" href="/base.css" >
</svelte:head>

{@render children()}
