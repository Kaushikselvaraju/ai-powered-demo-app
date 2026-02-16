import "dotenv/config";
import { handler } from "../netlify/functions/triage.js";

const userMessage =
  process.argv.slice(2).join(" ") ||
  "Our team triages hundreds of Jira tickets manually each week and it’s hard to prioritize and route them consistently.";

const result = await handler({
  httpMethod: "POST",
  body: JSON.stringify({ userMessage })
});

console.log("Status:", result.statusCode);
console.log(result.body);
