const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Keeps the board's SVG connection nodes stable across pointer frames.
 * A composition change rebuilds only the pool size; a card move mutates just
 * the lines that have that card as an endpoint.
 */
export function createWireRenderer({
  wire,
  boardWidth,
  boardHeight,
  requestFrame = callback => requestAnimationFrame(callback)
}) {
  let lines = [];
  let frame = null;
  let links = [];
  let cards = [];
  let needsFullRender = true;
  const dirtyCardIds = new Set();

  function drawLinks({ nextLinks, nextCards, changedCardId = null }) {
    links = Array.isArray(nextLinks) ? nextLinks : [];
    cards = Array.isArray(nextCards) ? nextCards : [];
    if (changedCardId) dirtyCardIds.add(changedCardId);
    else needsFullRender = true;
    if (frame !== null) return;
    frame = requestFrame(flush);
  }

  function flush() {
    frame = null;
    const redrawAll = needsFullRender || lines.length !== links.length;
    if (redrawAll) syncLinePool();
    const cardsById = new Map(cards.map(card => [card.id, card]));
    for (let index = 0; index < links.length; index += 1) {
      const [fromId, toId] = links[index];
      if (!redrawAll && !dirtyCardIds.has(fromId) && !dirtyCardIds.has(toId)) continue;
      drawLine(lines[index], cardsById.get(fromId), cardsById.get(toId));
    }
    dirtyCardIds.clear();
    needsFullRender = false;
  }

  function syncLinePool() {
    wire.setAttribute("viewBox", `0 0 ${boardWidth} ${boardHeight}`);
    while (lines.length > links.length) wire.removeChild(lines.pop());
    while (lines.length < links.length) {
      const line = wire.ownerDocument.createElementNS(SVG_NAMESPACE, "line");
      wire.appendChild(line);
      lines.push(line);
    }
  }

  function drawLine(line, from, to) {
    if (!from || !to) {
      line.setAttribute("visibility", "hidden");
      return;
    }
    line.removeAttribute("visibility");
    line.setAttribute("x1", String(from.x + from.w / 2));
    line.setAttribute("y1", String(from.y + from.h / 2));
    line.setAttribute("x2", String(to.x + to.w / 2));
    line.setAttribute("y2", String(to.y + to.h / 2));
  }

  return { drawLinks };
}
