import assert from "node:assert/strict";
import test from "node:test";
import { readAssuraSetting } from "../../src/lib/shared/environment.ts";

test("all renamed settings accept existing deployment values and prefer Assura names", () => {
  for (const name of [
    "WORKFLOW_ENABLED",
    "AI2_MODEL",
    "PUBLIC_ORIGIN",
    "CONTACT_URL",
    "EMAIL_FROM",
    "TEST_PASSWORD",
  ]) {
    const canonical = `ASSURA_${name}`;
    const legacy = `LEGALMATE_${name}`;
    assert.equal(readAssuraSetting(name, {}), undefined);
    assert.equal(readAssuraSetting(name, { [legacy]: "existing" }), "existing");
    assert.equal(
      readAssuraSetting(name, {}, { [legacy]: "existing" }),
      "existing",
    );
    assert.equal(
      readAssuraSetting(name, { [legacy]: "binding" }, { [legacy]: "process" }),
      "binding",
    );
    assert.equal(
      readAssuraSetting(name, { [legacy]: "existing" }, { [canonical]: "new" }),
      "new",
    );
    assert.equal(
      readAssuraSetting(
        name,
        { [canonical]: "binding" },
        { [canonical]: "process" },
      ),
      "binding",
    );
    assert.equal(
      readAssuraSetting(name, { [canonical]: "", [legacy]: "existing" }),
      "",
    );
    assert.equal(
      readAssuraSetting(name, { [legacy]: "existing" }, { [canonical]: "" }),
      "",
    );
  }
});
