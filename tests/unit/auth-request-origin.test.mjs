import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedRequestOrigin } from "../../src/lib/auth/request-origin.ts";

test("HTTPS deployment origin is accepted behind an HTTP loopback proxy", () => {
  assert.equal(
    isAllowedRequestOrigin(
      "http://127.0.0.1:8787/api/notes",
      "https://assura.example",
      "https://assura.example/",
    ),
    true,
  );
});

test("configured deployment rejects other origins including the internal origin", () => {
  for (const origin of [
    "https://attacker.example",
    "http://assura.example",
    "https://assura.example.attacker.example",
    "http://127.0.0.1:8787",
    "null",
    "",
  ]) {
    assert.equal(
      isAllowedRequestOrigin(
        "http://127.0.0.1:8787/api/notes",
        origin,
        "https://assura.example",
      ),
      false,
      origin,
    );
  }
});

test("without configuration, Sites and local requests use their request origin", () => {
  for (const origin of [
    "http://localhost:5173",
    "https://assura.chatgpt.site",
  ]) {
    assert.equal(isAllowedRequestOrigin(`${origin}/api/notes`, origin), true);
    assert.equal(
      isAllowedRequestOrigin(`${origin}/api/notes`, "https://attacker.example"),
      false,
    );
    assert.equal(isAllowedRequestOrigin(`${origin}/api/notes`, null), true);
  }
});

test("malformed public origin fails closed even without an Origin header", () => {
  for (const configured of [
    "",
    "not a URL",
    "https:assura.example",
    " https://assura.example",
    "https://assura.example ",
    "ftp://assura.example",
    "https://user:password@assura.example",
    "https://assura.example/worker",
    "https://assura.example/.",
    "https://assura.example?",
    "https://assura.example?test=true",
    "https://assura.example#",
    "https://assura.example#fragment",
  ]) {
    for (const origin of [null, "http://localhost:5173"]) {
      assert.throws(
        () =>
          isAllowedRequestOrigin(
            "http://localhost:5173/api/notes",
            origin,
            configured,
          ),
        /ASSURA_PUBLIC_ORIGIN/,
        configured,
      );
    }
  }
});
