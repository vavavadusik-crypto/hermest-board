// Внешность персонажа выводится из его id — это то, что держит труппу узнаваемой
// весь сезон. Но два разных id могут дать один и тот же цвет, и тогда в кадре
// стоят два одинаковых человека. Здесь проверяется и постоянство, и различимость.

import assert from "node:assert/strict";
import test from "node:test";

import { resolveCastLooks, resolveCharacterLook } from "../../src/media/cartoon-cast.js";

// Найдено перебором: эти два id независимо дают одну рубашку.
const COLLIDING = ["char-0", "char-32"];

test("appearance is derived from the id and does not drift", () => {
  const first = resolveCharacterLook({ id: "char-mark", name: "Марк" });
  const second = resolveCharacterLook({ id: "char-mark", name: "Марк" });
  assert.deepEqual(first, second);
  // Другой id — другой человек.
  const other = resolveCharacterLook({ id: "char-lena", name: "Лена" });
  assert.notDeepEqual(first, other);
});

test("two characters colliding on a colour are pulled apart in the same shot", () => {
  const [a, b] = COLLIDING.map(id => resolveCharacterLook({ id, name: "" }));
  assert.equal(a.shirt, b.shirt, "фикстура устарела: эти id больше не сталкиваются");

  const looks = resolveCastLooks(COLLIDING.map(id => ({ id, name: "" })));
  assert.notEqual(looks[0].shirt, looks[1].shirt, "в кадре остались два одинаковых силуэта");
  // Правится второй, первый остаётся собой — иначе персонаж менял бы вид от того,
  // с кем он оказался в кадре.
  assert.equal(looks[0].shirt, a.shirt);
});

test("a lone character keeps exactly the look his id gives him", () => {
  const solo = resolveCastLooks([{ id: "char-mark", name: "Марк" }]);
  assert.deepEqual(solo[0], resolveCharacterLook({ id: "char-mark", name: "Марк" }));
});

test("pulling colours apart is deterministic for the same shot", () => {
  const cast = [{ id: "char-0", name: "" }, { id: "char-32", name: "" }, { id: "char-7", name: "" }];
  assert.deepEqual(resolveCastLooks(cast), resolveCastLooks(cast));
});

test("an explicit look still wins over the derived one", () => {
  const looks = resolveCastLooks([{ id: "char-mark", name: "Марк", look: { hairStyle: "bun" } }]);
  assert.equal(looks[0].hairStyle, "bun");
});
