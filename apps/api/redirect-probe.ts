import { safeFetch } from "./src/services/egress";
async function main() {
  for (const u of [
    "https://httpbingo.org/redirect-to?url=https://example.com/&status_code=302",
    "https://httpbin.org/redirect-to?url=https://example.com/",
  ]) {
    try {
      const r = await safeFetch(u, { purpose: "monitor", timeoutMs: 9000 });
      console.log(u, "-> returned", r.status, "(NOT thrown)");
    } catch (e) {
      console.log(u, "-> threw:", (e as Error).name, (e as Error).message);
    }
  }
}
void main();
