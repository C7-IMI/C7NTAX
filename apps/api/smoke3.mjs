import * as shared from "../../packages/shared/src/index.ts";
const keys = Object.keys(shared);
console.log("count:", keys.length);
console.log("has createBlankDocument:", keys.includes("createBlankDocument"));
console.log("report-ish:", keys.filter(k => /Template|layout|Band|Expr|Function/i.test(k)).slice(0, 20));
console.log("sample:", keys.slice(0, 15));
