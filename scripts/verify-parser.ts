import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeChat } from "../src/lib/analyze";
import { parseWhatsAppChat } from "../src/lib/parseChat";

const iosSample = `[01/01/25, 9:01:12 AM] Alex: Hello there
[01/01/25, 9:02:04 AM] Sam: Hi! 🎉
[01/01/25, 9:03:00 AM] Alex: image omitted
`;

const androidSample = `01/01/25, 9:01 AM - Alex: Hello there
01/01/25, 9:02 AM - Sam: Hi! 🎉
01/01/25, 9:03 AM - Alex: image omitted
`;

const iosMessages = parseWhatsAppChat(iosSample);
assert.equal(iosMessages.length, 3);
assert.equal(iosMessages[0].user, "Alex");
assert.equal(iosMessages[1].message.includes("🎉"), true);

const androidMessages = parseWhatsAppChat(androidSample);
assert.equal(androidMessages.length, 3);
assert.equal(androidMessages[1].user, "Sam");

const samplePath = join(process.cwd(), "public/sample-chat.txt");
const sample = readFileSync(samplePath, "utf8");
const parsedSample = parseWhatsAppChat(sample);
assert.ok(parsedSample.length > 20);

const analysis = analyzeChat(parsedSample, "Overall", new Set(["the", "a", "to"]));
assert.ok(analysis.stats.totalMessages > 0);
assert.ok(analysis.monthlyTimeline.length > 0);
assert.ok(analysis.emojis.length > 0);

console.log("Parser and analysis checks passed.");
console.log(`Sample messages: ${parsedSample.length}`);
console.log(`Stats:`, analysis.stats);
