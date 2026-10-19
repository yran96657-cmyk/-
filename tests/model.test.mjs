import test from "node:test";
import assert from "node:assert/strict";
import {
  plainDocument,
  validateDocument,
  sampleDocument,
  History,
} from "../src/model.mjs";
test("project roundtrip preserves Unicode, line breaks and literal HTML", () => {
  const doc = plainDocument("甲😀乙\r\n<script>alert(1)</script>\n第三段");
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  assert.deepEqual(
    doc.blocks.map((b) => b.text),
    ["甲😀乙", "<script>alert(1)</script>", "第三段"],
  );
});
test("invalid layout never silently corrupts geometry", () => {
  const doc = sampleDocument();
  for (const layout of [
    { columns: 1.5 },
    { fontSize: NaN },
    { width: 100, inner: 60, outer: 50 },
    { height: 140, top: 60, bottom: 60 },
  ])
    assert.throws(() =>
      validateDocument({ ...doc, layout: { ...doc.layout, ...layout } }),
    );
});
test("reject unsupported file versions and external image URLs", () => {
  const doc = sampleDocument();
  assert.throws(() => validateDocument({ ...doc, version: 5 }));
  assert.throws(() =>
    validateDocument({
      ...doc,
      blocks: [{ type: "image", src: "https://example.com/p.png" }],
    }),
  );
  assert.throws(() =>
    validateDocument({
      ...doc,
      blocks: [{ type: "image", src: "data:image/svg+xml;base64,AAAA" }],
    }),
  );
});
test("history restores deletes and clears redo after divergent edit", () => {
  const h = new History(),
    doc = plainDocument("一\n二");
  h.push(doc);
  doc.blocks.pop();
  const restored = h.undo(doc);
  assert.equal(restored.blocks.length, 2);
  assert.equal(h.redo(restored).blocks.length, 1);
  h.undo(doc);
  h.push(restored);
  assert.equal(h.redo(restored), null);
});
test("empty documents valid and colliding ids replaced", () => {
  assert.equal(plainDocument("").blocks.length, 0);
  const doc = plainDocument("一\n二");
  doc.blocks[1].id = doc.blocks[0].id;
  const restored = validateDocument(doc);
  assert.notEqual(restored.blocks[0].id, restored.blocks[1].id);
});
