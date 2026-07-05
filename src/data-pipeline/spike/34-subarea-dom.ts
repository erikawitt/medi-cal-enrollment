/** Spike 34: are the Sub Administrative Area list labels real DOM text with
 * usable bounding boxes? If so the driver can click named rows instead of
 * blind pixel offsets (which systematically miss the first row).
 */
import { launchEmbed, closeSharedBrowser, selectGeoType, subAreaZone } from "../src/embed.ts";

const embed = await launchEmbed({ headless: true });
try {
  await selectGeoType(embed, "Congressional District");
  const zone = await subAreaZone(embed);
  console.log("[34] zone:", JSON.stringify(zone));
  const texts = await embed.frame.evaluate((z) => {
    const out: { text: string; x: number; y: number; w: number; h: number; tag: string; cls: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const t = node.textContent?.trim();
      if (!t || t.length > 40) continue;
      const el = node.parentElement;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // keep only nodes inside the sub-area zone
      if (r.left >= z.x - 5 && r.left <= z.x + z.w && r.top >= z.y - 5 && r.top <= z.y + z.h + 5) {
        out.push({ text: t, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName, cls: el.className.toString().slice(0, 60) });
      }
    }
    return out;
  }, zone);
  for (const t of texts) console.log("[34]", JSON.stringify(t));
} finally {
  await embed.close();
  await closeSharedBrowser();
  process.exit(0);
}
