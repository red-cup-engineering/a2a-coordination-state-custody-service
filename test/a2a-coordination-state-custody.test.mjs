import { test } from "node:test";
import assert from "node:assert/strict";
import { createA2aCoordinationStateCustody, createA2aCoordinationStateCustodyFromEnvironment } from "../src/a2a-coordination-state-custody.mjs";

function fakeR2() {
  const store = new Map();
  return {
    async putCurrent(key, { body, byteLength, sha256 }) {
      assert.equal(byteLength, body.length);
      assert.ok(/^[a-f0-9]{64}$/u.test(sha256));
      store.set(key, { body, etag: `etag-${store.size}` });
    },
    async get(key) {
      const object = store.get(key);
      return object ? Object.freeze({ body: object.body, etag: object.etag }) : null;
    },
    async list(prefix) {
      const keys = [...store.keys()].filter((key) => key.startsWith(prefix));
      return Object.freeze({ keys, continuationToken: undefined });
    },
  };
}

test("put then get round-trips the causal head", async () => {
  const custody = createA2aCoordinationStateCustody({ client: fakeR2() });
  await custody.put({ namespace: "ns", key: "k", value: { count: 1 } });
  const head = await custody.get({ namespace: "ns", key: "k" });
  assert.deepEqual(head.value, { count: 1 });
});

test("environment factory retires R2 for thin coordination state", () => {
  assert.throws(
    () => createA2aCoordinationStateCustodyFromEnvironment({ API_KEY_CLOUDFLARE_R2_EDIT: "token" }),
    /R2 custody is retired/u,
  );
});

test("successive puts chain causally and get returns the latest", async () => {
  const custody = createA2aCoordinationStateCustody({ client: fakeR2() });
  await custody.put({ namespace: "ns", key: "k", value: { count: 1 } });
  await custody.put({ namespace: "ns", key: "k", value: { count: 2 } });
  const head = await custody.get({ namespace: "ns", key: "k" });
  assert.deepEqual(head.value, { count: 2 });
});

test("remove tombstones the key so get and list omit it", async () => {
  const custody = createA2aCoordinationStateCustody({ client: fakeR2() });
  await custody.put({ namespace: "ns", key: "k", value: { count: 1 } });
  assert.equal(await custody.remove({ namespace: "ns", key: "k" }), true);
  assert.equal(await custody.get({ namespace: "ns", key: "k" }), null);
  assert.deepEqual(await custody.list({ namespace: "ns" }), []);
});
