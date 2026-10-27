import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer.ts";
import { buildCorpus, find, tokens } from "../src/search.ts";

const root = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const idx = buildIndex(root);
const corpus = buildCorpus(idx);
const ids = (q: string, o = {}) => find(corpus, q, o).map((r) => r.id.split("#")[1]);

test("tokenizer splits camelCase, drops stopwords/1-char, stems lightly", () => {
  assert.deepEqual(tokens("PriceTag"), ["price", "tag"]);
  assert.deepEqual(tokens("the a of Buttons"), ["button"]);
  assert.deepEqual(tokens("formatting importer"), ["formatt", "import"]);
  assert.deepEqual(tokens("use-cart_item x"), ["use", "cart", "item"]);
  assert.deepEqual(tokens("class"), ["class"]); // "ss" keeps its s
  assert.deepEqual(tokens(undefined), []);
});

test("'price tag' ranks PriceTag and PriceLabel first", () => {
  assert.deepEqual(ids("price tag").slice(0, 2).sort(), ["PriceLabel", "PriceTag"]);
  assert.equal(ids("price tag")[0], "PriceTag"); // matches both tokens
});

test("kind filter and name weight: 'button' finds Button first", () => {
  const r = find(corpus, "button", { kind: "component" });
  assert.equal(r[0].id, "src/components/ui/Button.tsx#Button");
  assert.ok(r.every((x) => x.kind === "component"));
  assert.deepEqual(find(corpus, "button", { kind: "store" }), []);
});

test("result shape and deprecated flag", () => {
  const r = find(corpus, "old card")[0];
  assert.equal(r.id, "src/components/ui/OldCard.tsx#OldCard");
  assert.equal(r.deprecated, true);
  for (const k of ["kind", "file", "line", "doc", "props", "callers", "area", "score"]) assert.ok(k in r, k);
  assert.ok(r.score > 0);
});

test("prop names are searchable at weight 1; purposes at weight 2", () => {
  assert.ok(ids("variant").includes("Button"));
  const withPurpose = buildCorpus(idx, { purposes: { "src/features/cart/CartBadge.tsx#CartBadge": "shows basket quantity" } });
  assert.equal(find(withPurpose, "basket quantity")[0].id, "src/features/cart/CartBadge.tsx#CartBadge");
  const withText = buildCorpus(idx, { patternText: { "src/components/ui/Input.tsx#Input": ["always use for forms"] } });
  assert.equal(find(withText, "forms")[0].id, "src/components/ui/Input.tsx#Input");
});

test("5-char prefix partial match, limit, empty and stopword-only queries", () => {
  const calc = { id: "c.ts#Calculator", name: "Calculator", kind: "function", file: "c.ts", line: 1, doc: "", callers: 0, area: "o", deprecated: false, deprecatedText: "", props: [], exported: true };
  const [hit] = find(buildCorpus({ symbols: { [calc.id]: calc } } as any), "calculation"); // calculat ~ calculator via "calcu"
  assert.ok(Math.abs(hit.score - 3 * 0.6 * Math.log(2)) < 1e-9);
  assert.equal(find(corpus, "price", { limit: 1 }).length, 1);
  assert.deepEqual(find(corpus, "the of"), []);
  assert.deepEqual(find(corpus, "zzzqqq"), []);
});

test("non-exported symbols are scaled by 0.6", () => {
  const sym = { id: "a.ts#Widget", name: "Widget", kind: "component", file: "a.ts", line: 1, doc: "", callers: 0, area: "other", deprecated: false, deprecatedText: "", props: [] };
  const c = buildCorpus({ symbols: { "a.ts#Widget": { ...sym, exported: true }, "b.ts#Widget": { ...sym, id: "b.ts#Widget", file: "b.ts", exported: false } } } as any);
  const [pub, priv] = find(c, "widget");
  assert.equal(pub.file, "a.ts");
  assert.ok(Math.abs(priv.score / pub.score - 0.6) < 1e-9);
});

test("callers add a log bonus; ties break by id", () => {
  const mk = (id: string, callers: number) => ({ id, name: "Foo", kind: "component", file: id, line: 1, doc: "", callers, area: "o", deprecated: false, deprecatedText: "", props: [], exported: true });
  const c = buildCorpus({ symbols: { b: mk("b", 0), a: mk("a", 0), c: mk("c", 5) } } as any);
  assert.deepEqual(find(c, "foo").map((r) => r.id), ["c", "a", "b"]);
});
