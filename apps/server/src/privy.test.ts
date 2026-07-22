import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionForAddress } from "./auth.js";
import { displayNameFromUser, embeddedAddressFromUser, type PrivyUserShape } from "./privy.js";
import { Store } from "./store.js";

const EMBEDDED = "0x1111111111111111111111111111111111111111";
const EXTERNAL = "0x2222222222222222222222222222222222222222";

test("embeddedAddressFromUser prefers the Privy embedded wallet", () => {
  const user: PrivyUserShape = {
    linkedAccounts: [
      { type: "wallet", address: EXTERNAL, walletClientType: "metamask", connectorType: "injected" },
      { type: "wallet", address: EMBEDDED, walletClientType: "privy", connectorType: "embedded" },
    ],
  };
  assert.equal(embeddedAddressFromUser(user), EMBEDDED);
});

test("embeddedAddressFromUser falls back to a connected wallet, lowercased", () => {
  const user: PrivyUserShape = {
    linkedAccounts: [{ type: "wallet", address: EXTERNAL.toUpperCase(), walletClientType: "metamask" }],
  };
  assert.equal(embeddedAddressFromUser(user), EXTERNAL);
});

test("embeddedAddressFromUser returns empty when there is no wallet", () => {
  assert.equal(embeddedAddressFromUser({ linkedAccounts: [{ type: "email" }] }), "");
  assert.equal(embeddedAddressFromUser({}), "");
});

test("displayNameFromUser derives a handle from the linked account", () => {
  assert.equal(displayNameFromUser({ twitter: { username: "griller" } }), "griller");
  assert.equal(displayNameFromUser({ email: { address: "chef@example.com" } }), "chef");
  assert.equal(displayNameFromUser({}), undefined);
});

test("createSessionForAddress issues a session and creates the profile", () => {
  const store = new Store();
  const { token, isNew } = createSessionForAddress(store, EMBEDDED);
  assert.equal(isNew, true);
  assert.equal(store.sessionAddress(token), EMBEDDED.toLowerCase());
  // Second time, the same address is not new.
  assert.equal(createSessionForAddress(store, EMBEDDED).isNew, false);
});

test("createSessionForAddress honours the invite gate", () => {
  const prev = process.env.BETA_WHITELIST;
  process.env.BETA_WHITELIST = "1";
  try {
    const store = new Store();
    assert.throws(
      () => createSessionForAddress(store, EMBEDDED),
      (e: Error & { status?: number }) => e.status === 403,
    );
  } finally {
    if (prev === undefined) delete process.env.BETA_WHITELIST;
    else process.env.BETA_WHITELIST = prev;
  }
});
