// ListCard's delegated card behaviour. Lives in a module (not inline in the
// component) so pages that insert these cards after load — the reviewer
// profile's on-demand tabs — can import it up front; a component's <script>
// only ships with pages that render the component. Self-guarded, so
// importing it from several places still registers it once.
if (!(window as any).__lcTileInit) {
  (window as any).__lcTileInit = true;

  document.addEventListener('click', async function (e) {
    const deleteBtn = (e.target as HTMLElement)?.closest('.lc-tile-delete-btn') as HTMLButtonElement | null;
    if (!deleteBtn) return;

    if (!confirm('Delete this list permanently? This cannot be undone.')) return;
    const listId = deleteBtn.dataset.deleteListId;
    deleteBtn.disabled = true;
    const res = await fetch('/api/lists/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_id: listId }),
    });
    if (!res.ok) {
      deleteBtn.disabled = false;
      alert('Failed to delete list.');
      return;
    }
    const card = deleteBtn.closest('.list-card') as HTMLElement | null;
    if (card) {
      card.style.transition = 'opacity 0.3s, max-height 0.4s';
      card.style.overflow = 'hidden';
      card.style.opacity = '0';
      card.style.maxHeight = card.offsetHeight + 'px';
      setTimeout(function () { card.style.maxHeight = '0'; }, 50);
      setTimeout(function () { card.remove(); }, 450);
    }
  });
}
