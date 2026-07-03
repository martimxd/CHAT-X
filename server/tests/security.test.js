import { describe, expect, it } from "vitest";
import { encryptForStorage, decryptFromStorage, randomToken, sha256Hex } from "../src/lib/crypto.js";
import { validatePassword, validateUsername } from "../src/lib/validators.js";

describe("security helpers", () => {
  it("enforces username policy", () => {
    expect(validateUsername("alice_01")).toBe(true);
    expect(validateUsername("ab")).toBe(false);
    expect(validateUsername("alice@example.com")).toBe(false);
  });

  it("enforces password strength", () => {
    expect(validatePassword("StrongPass1!")).toBe(true);
    expect(validatePassword("weakpassword")).toBe(false);
    expect(validatePassword("NoSymbol123")).toBe(false);
  });

  it("encrypts and decrypts storage payloads", () => {
    const source = Buffer.from("private payload");
    const encrypted = encryptForStorage(source);
    expect(encrypted.ciphertext.equals(source)).toBe(false);
    expect(decryptFromStorage(encrypted.ciphertext, encrypted.envelope).toString("utf8")).toBe("private payload");
  });

  it("generates unique opaque tokens", () => {
    const one = randomToken();
    const two = randomToken();
    expect(one).not.toEqual(two);
    expect(sha256Hex(one)).toHaveLength(64);
  });
});
