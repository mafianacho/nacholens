import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
export const demoModel = () => readJson("models/demo-shop/model.json");
export const demoChanges = () => readJson("models/demo-shop/changes.example.json");
export const demoAutoChanges = () => readJson("models/demo-shop/changes.auto.json");
export const clone = (v) => JSON.parse(JSON.stringify(v));

/** Smallest valid model, for focused mutation tests. */
export function tiny() {
  const ev = [{ file: "a.js", lines: [1, 2], contains: "x" }];
  return {
    schemaVersion: 1,
    product: { id: "tiny", name: "Tiny", description: "d" },
    source: { repo: "o/r", commit: "abc1234" },
    components: [
      { id: "web", kind: "client", label: "Web", detail: "d", evidence: ev },
      { id: "gw", kind: "gateway", label: "GW", detail: "d", evidence: ev },
      { id: "api", kind: "service", label: "API", detail: "d", evidence: ev },
      { id: "db", kind: "datastore", label: "DB", detail: "d", evidence: ev },
    ],
    links: [
      { a: "web", b: "gw", label: "l", evidence: ev },
      { a: "gw", b: "api", label: "l", evidence: ev },
      { a: "api", b: "db", label: "l", evidence: ev },
    ],
    useCases: [
      {
        id: "uc", title: "T", summary: "S", trigger: "GET /x",
        steps: [
          { id: "s1", kind: "request", from: "web", via: ["gw"], to: "api", label: "L", narration: "N", request: "R", evidence: ev },
          { id: "s2", kind: "call", from: "api", to: "db", label: "L", narration: "N", request: "R", response: "P", evidence: ev },
          { id: "s3", kind: "internal", from: "api", to: "api", label: "L", narration: "N", evidence: ev },
          { id: "s4", kind: "response", from: "api", via: ["gw"], to: "web", label: "L", narration: "N", response: "P", evidence: ev },
        ],
      },
    ],
  };
}
