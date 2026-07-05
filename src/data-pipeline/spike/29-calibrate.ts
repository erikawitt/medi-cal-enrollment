/** Spike 29: calibrate sub-area click geometry. After selecting SPA type, click
 * down the Sub Administrative Area zone at fine y-steps and record which SPA the
 * embed reports selected, to derive the list's top offset and row pitch. */
import { launchEmbed, selectGeoType, subAreaZone } from "../src/embed.ts";

const embed = await launchEmbed({ headless: true });
try {
  await selectGeoType(embed, "Service Planning Area");
  const zone = await subAreaZone(embed);
  console.log("[29] zone:", JSON.stringify(zone));
  const el = await embed.frame.frameElement();
  const box = (await el.boundingBox())!;

  for (let dy = 20; dy <= zone.h; dy += 12) {
    embed.drainResponses();
    await embed.page.mouse.click(box.x + zone.x + 18, box.y + zone.y + dy);
    await new Promise((r) => setTimeout(r, 900));
    const body = embed.drainResponses().join("\n");
    const title = body.match(/Service Planning Area \d+|Unknown/)?.[0];
    if (title) console.log(`[29] dy=${dy} -> ${title}`);
  }
} finally {
  await embed.close();
}
