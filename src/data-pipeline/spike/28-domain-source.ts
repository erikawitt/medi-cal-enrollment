/** Spike 28: after selecting SPA type, capture the full response window and find
 * where the SPA 1..8 sub-area domain actually lives vs. the geo-type list. */
import { launchEmbed, selectGeoType } from "../src/embed.ts";
import { writeFileSync } from "node:fs";

const embed = await launchEmbed({ headless: true });
try {
  const resp = await selectGeoType(embed, "Service Planning Area");
  writeFileSync(new URL("./out/geo-type-select.txt", import.meta.url).pathname, resp);
  // Extra settle + drain to catch the sub-area list render.
  await new Promise((r) => setTimeout(r, 3000));
  const more = embed.drainResponses().join("\n");
  writeFileSync(new URL("./out/geo-type-more.txt", import.meta.url).pathname, more);

  for (const [label, text] of [["select", resp], ["more", more]] as const) {
    const toks = [...text.matchAll(/"([^"|]+)\|(?:Checked|Unchecked)"/g)].map((m) => m[1]);
    console.log(`[28] ${label}: len=${text.length} uniqueTokens=`, JSON.stringify([...new Set(toks)]));
    const spa = [...text.matchAll(/"(SPA \d|Unknown)"/g)].map((m) => m[1]);
    console.log(`[28] ${label}: clean SPA tokens=`, JSON.stringify([...new Set(spa)]));
  }
} finally {
  await embed.close();
}
