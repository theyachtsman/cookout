import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { issueNonce, nonceMessage, verifyAndCreateSession } from "./auth.js";
import { SESSION_TTL_MS, Store } from "./store.js";

const account = privateKeyToAccount(generatePrivateKey());

test("sign-in: SIWE message is domain-bound and verifies round-trip", async () => {
  const store = new Store();
  const { message } = issueNonce(store, account.address);
  assert.match(message, /^localhost:3000 wants you to sign in with your Ethereum account:/);
  assert.match(message, /Expiration Time: /);

  const signature = await account.signMessage({ message });
  const { token } = await verifyAndCreateSession(store, account.address, signature);
  assert.equal(store.sessionAddress(token), account.address.toLowerCase());

  // Nonce is single-use: replaying the same signature fails.
  await assert.rejects(
    () => verifyAndCreateSession(store, account.address, signature),
    /no nonce issued/,
  );
});

test("sign-in: expired nonce is rejected and cleared", async () => {
  const store = new Store();
  const key = account.address.toLowerCase();
  const { nonce } = issueNonce(store, account.address);
  const stale = Date.now() - 6 * 60 * 1000;
  store.nonces.set(key, { nonce, issuedAt: stale });

  const signature = await account.signMessage({
    message: nonceMessage(account.address, nonce, stale),
  });
  await assert.rejects(
    () => verifyAndCreateSession(store, account.address, signature),
    /expired/,
  );
  assert.equal(store.nonces.has(key), false);
});

test("sign-in: a signature over a different domain's message never verifies", async () => {
  const store = new Store();
  issueNonce(store, account.address);
  const phished = await account.signMessage({
    message: "evil.example wants you to sign in with your Ethereum account:\n" + account.address,
  });
  await assert.rejects(
    () => verifyAndCreateSession(store, account.address, phished),
    /invalid signature/,
  );
});

test("sessions: expire lazily and legacy snapshot entries migrate", () => {
  const store = new Store();
  store.sessions.set("live", { address: "0xaa", expiresAt: Date.now() + 1000 });
  store.sessions.set("dead", { address: "0xbb", expiresAt: Date.now() - 1 });
  assert.equal(store.sessionAddress("live"), "0xaa");
  assert.equal(store.sessionAddress("dead"), undefined);
  assert.equal(store.sessions.has("dead"), false, "expired token is deleted on touch");

  // Expired sessions are pruned from snapshots.
  store.sessions.set("dead2", { address: "0xcc", expiresAt: Date.now() - 1 });
  const snap = store.snapshot();
  assert.deepEqual(
    snap.sessions?.map(([t]) => t),
    ["live"],
  );

  // Legacy bare-address entries (pre-expiry snapshots) get a fresh TTL.
  const fresh = new Store();
  fresh.hydrate({ ...snap, sessions: [["legacy", "0xdd"]] });
  assert.equal(fresh.sessionAddress("legacy"), "0xdd");
  const rec = fresh.sessions.get("legacy")!;
  assert.ok(rec.expiresAt > Date.now() && rec.expiresAt <= Date.now() + SESSION_TTL_MS);
});
