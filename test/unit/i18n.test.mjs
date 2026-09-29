import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { L, detectLang, label, setLang, t, tr } from "../../src/i18n/index.mjs";
import { MESSAGES } from "../../src/i18n/messages.mjs";

describe("i18n", () => {
  it("every English key has a French translation", () => {
    const missing = Object.keys(MESSAGES.en).filter((k) => !(k in MESSAGES.fr));
    assert.deepEqual(missing, []);
    const extra = Object.keys(MESSAGES.fr).filter((k) => !(k in MESSAGES.en));
    assert.deepEqual(extra, []);
  });

  it("placeholders match between languages", () => {
    const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const [k, en] of Object.entries(MESSAGES.en)) assert.equal(names(MESSAGES.fr[k]), names(en), k);
  });

  it("detects the language from SMART_DELEGATE_LANG, then the locale", () => {
    assert.equal(detectLang({ SMART_DELEGATE_LANG: "fr" }), "fr");
    assert.equal(detectLang({ LANG: "fr_FR.UTF-8" }), "fr");
    assert.equal(detectLang({ LC_ALL: "en_US.UTF-8", LANG: "fr_FR.UTF-8" }), "en");
    assert.equal(detectLang({ LANG: "C" }), "en");
    assert.equal(detectLang({}), "en");
  });

  it("runtime messages are plain English strings that re-render in French", () => {
    const producers = Object.keys(MESSAGES.en).filter((k) => /^(ex|warn|why|prof|risk|run)\./.test(k));
    for (const key of producers) {
      const params = Object.fromEntries([...MESSAGES.en[key].matchAll(/\{(\w+)\}/g)].map((m) => [m[1], `P${m[1]}Z`]));
      const english = L(key, params);
      assert.equal(typeof english, "string");
      assert.equal(tr(english, "fr"), t(key, params, "fr"), key);
    }
  });

  it("label parameters are translated too", () => {
    const s = L("ex.floor", { floor: "feature", dim: L("dim.reliability"), value: 0.7, min: 0.75 });
    assert.equal(tr(s, "fr"), "sous le plancher de qualité « feature » : fiabilité 0.7 < 0.75");
    assert.equal(tr("text nobody produced", "fr"), "text nobody produced");
    assert.equal(label("status", "verified", "fr"), "vérifié");
  });

  it("setLang switches t()", () => {
    setLang("fr");
    assert.equal(t("status.failed"), "échec");
    setLang("en");
    assert.equal(t("status.failed"), "failed");
    assert.throws(() => setLang("de"));
  });
});
