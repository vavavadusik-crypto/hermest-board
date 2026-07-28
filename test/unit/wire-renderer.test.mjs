import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createWireRenderer } from "../../src/ui/wire-renderer.js";

class FakeLine {
  constructor() {
    this.attributes = new Map();
    this.attributeWrites = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    this.attributeWrites += 1;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

class FakeWire {
  constructor() {
    this.children = [];
    this.attributes = new Map();
    this.ownerDocument = { createElementNS: () => new FakeLine() };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  appendChild(line) {
    this.children.push(line);
  }

  removeChild(line) {
    this.children.splice(this.children.indexOf(line), 1);
  }
}

function frameQueue() {
  const callbacks = [];
  return {
    requestFrame(callback) {
      callbacks.push(callback);
      return callbacks.length;
    },
    flush() {
      const callback = callbacks.shift();
      assert.ok(callback, "a render frame was scheduled");
      callback();
    }
  };
}

test("#wire keeps its line nodes during a card drag and redraws only connected links", () => {
  const wire = new FakeWire();
  const frames = frameQueue();
  const renderer = createWireRenderer({
    wire,
    boardWidth: 3000,
    boardHeight: 1800,
    requestFrame: frames.requestFrame
  });
  const cards = [
    { id: "a", x: 10, y: 20, w: 100, h: 100 },
    { id: "b", x: 220, y: 20, w: 100, h: 100 },
    { id: "c", x: 10, y: 240, w: 100, h: 100 },
    { id: "d", x: 220, y: 240, w: 100, h: 100 }
  ];
  const links = [["a", "b"], ["c", "d"]];

  renderer.drawLinks({ nextLinks: links, nextCards: cards });
  frames.flush();
  const [firstLine, secondLine] = wire.children;
  assert.equal(wire.children.length, links.length, "#wire has one node per link");

  firstLine.attributeWrites = 0;
  secondLine.attributeWrites = 0;
  cards[0].x += 80;
  renderer.drawLinks({ nextLinks: links, nextCards: cards, changedCardId: "a" });
  frames.flush();

  assert.equal(wire.children.length, links.length, "drag preserves the node count");
  assert.equal(wire.children[0], firstLine, "the affected link reuses its SVG node");
  assert.equal(wire.children[1], secondLine, "the untouched link reuses its SVG node");
  assert.ok(firstLine.attributeWrites > 0, "the moved card's link is redrawn");
  assert.equal(secondLine.attributeWrites, 0, "an unrelated link is not redrawn");
});

test("app delegates drag link rendering to the pooled renderer", async () => {
  const app = await readFile("src/app.js", "utf8");
  assert.ok(app.includes('import { createWireRenderer } from "./ui/wire-renderer.js"'), "app imports the pooled renderer");
  assert.ok(app.includes("drawLinks(card.id)"), "drag marks only its card's links dirty");
  assert.equal(app.includes("wire.innerHTML ="), false, "app never clears #wire for every drag frame");
});
