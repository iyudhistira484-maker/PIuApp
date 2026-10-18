import test from "node:test";
import assert from "node:assert/strict";
import {
  changedFields,
  shortId,
  validateEmail,
  validateName,
  validatePassword,
} from "../src/lib/profile";

test("display names are trimmed, never blank, and capped", () => {
  assert.deepEqual(validateName("  Andi  Pratama "), {
    value: "Andi Pratama",
    error: "",
  });
  assert.deepEqual(
    validateName("A").error,
    "Nama tampilan minimal 2 karakter.",
  );
  assert.match(validateName("x".repeat(61)).error, /maksimal 60 karakter/);
  assert.equal(validateName("x".repeat(60)).error, "");
});

test("password changes need a match and a usable minimum", () => {
  assert.match(validatePassword("pendek", "pendek"), /minimal 8 karakter/);
  assert.match(validatePassword("rahasia123", "rahasia124"), /tidak cocok/);
  assert.equal(validatePassword("rahasia123", "rahasia123"), "");
});

test("email changes are validated and can never repeat the current address", () => {
  assert.match(validateEmail("bukan-email"), /tidak valid/);
  assert.match(validateEmail(""), /tidak valid/);
  assert.equal(validateEmail(" Baru@Email.com "), "");
  assert.match(
    validateEmail("lama@email.com", "Lama@Email.com"),
    /sudah dipakai/,
  );
  assert.equal(validateEmail("baru@email.com", "lama@email.com"), "");
});

test("only fields that really changed are sent to the auth service", () => {
  const current = { name: "Andi", email: "andi@email.com" };
  assert.deepEqual(changedFields(current, {}), {});
  assert.deepEqual(changedFields(current, { name: "  Andi " }), {});
  assert.deepEqual(changedFields(current, { name: "" }), {});
  assert.deepEqual(changedFields(current, { name: "Andi Pratama" }), {
    name: "Andi Pratama",
  });
  assert.deepEqual(
    changedFields(current, { email: "andi@email.com" }),
    {},
    "the same email in a different case is not a change",
  );
  assert.deepEqual(changedFields(current, { email: "baru@email.com" }), {
    email: "baru@email.com",
  });
  assert.deepEqual(
    changedFields(current, { email: "rusak" }),
    {},
    "an invalid address is not sent, it is rejected by the form",
  );
});

test("account ids are shortened only when they are long", () => {
  assert.equal(
    shortId("c9d4b2e3-2222-4333-8444-555566667777"),
    "c9d4b2e3…7777",
  );
  assert.equal(shortId("pendek"), "pendek");
  assert.equal(shortId(null), "");
});
