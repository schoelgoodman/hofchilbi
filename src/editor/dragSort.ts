/**
 * Sorting list items by dragging their handle. Pointer events, not HTML drag and drop: that does
 * not work on phones. While dragging all items are shown collapsed, so a few rows of titles are
 * being sorted instead of forms of very different heights. The DOM follows the pointer; the actual
 * change happens in `onDrop`, which re-renders the list.
 */
const EDGE = 90;
const SCROLL_SPEED = 12;

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

export function startDrag(down: PointerEvent, onDrop: (from: number, to: number) => void): void {
  if (down.button !== 0) return;
  down.preventDefault();
  const handle = down.currentTarget as HTMLElement;
  const row = handle.closest<HTMLElement>(".item")!;
  const list = row.parentElement!;
  const rows = () => [...list.querySelectorAll<HTMLElement>(":scope > .item")];
  const from = rows().indexOf(row);
  const scroll = (top: number) => window.scrollBy({ top, behavior: "instant" });
  let y = down.clientY;
  let grab = 0;
  let frame = 0;
  let active = false;
  handle.setPointerCapture(down.pointerId);

  /**
   * Puts the row at this position among the others by moving those: taking the row itself out of
   * the document would end the pointer capture and, on touch screens, the touch.
   */
  const arrange = (to: number) => {
    const all = rows();
    const at = all.indexOf(row);
    const others = all.filter((r) => r !== row);
    for (const r of others.slice(at, to)) list.insertBefore(r, row);
    for (const r of others.slice(to, at).reverse()) list.insertBefore(r, row.nextElementSibling);
  };
  const place = () => {
    row.style.transform = "";
    const others = rows().filter((r) => r !== row);
    const next = others.findIndex((r) => {
      const box = r.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    arrange(next === -1 ? others.length : next);
    row.style.transform = `translateY(${y - grab - row.getBoundingClientRect().top}px)`;
  };
  const tick = () => {
    // Only when heading there: a row that happens to be near the edge is not being taken up there.
    if (y < EDGE && y < down.clientY) scroll(-SCROLL_SPEED);
    else if (y > window.innerHeight - EDGE && y > down.clientY) scroll(SCROLL_SPEED);
    place();
    frame = requestAnimationFrame(tick);
  };
  const begin = () => {
    active = true;
    const top = row.getBoundingClientRect().top;
    grab = down.clientY - top;
    list.classList.add("list--dragging");
    row.classList.add("item--dragging");
    // The collapsing moves everything: keep the row under the pointer.
    scroll(row.getBoundingClientRect().top - top);
    tick();
  };
  const move = (e: PointerEvent) => {
    y = e.clientY;
    if (!active && Math.abs(y - down.clientY) > 4) begin();
  };
  const end = (cancelled: boolean) => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", cancel);
    if (!active) return;
    cancelAnimationFrame(frame);
    row.style.transform = "";
    row.classList.remove("item--dragging");
    list.classList.remove("list--dragging");
    if (cancelled) {
      arrange(from);
      return;
    }
    const to = rows().indexOf(row);
    if (to !== from) onDrop(from, to);
  };
  const up = () => end(false);
  const cancel = () => end(true);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
}
