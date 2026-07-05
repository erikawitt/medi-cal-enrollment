/** Spike 27: exercise the real driver (src/embed.ts) end-to-end on SPA. */
import { launchEmbed, selectGeoType, parseSubAreaDomain, captureSubArea } from "../src/embed.ts";
import { extractPresModel, reconstructWorksheet } from "../src/vizql.ts";

const embed = await launchEmbed({ headless: true });
try {
  const resp = await selectGeoType(embed, "Service Planning Area");
  const domain = parseSubAreaDomain(resp, "Service Planning Area");
  console.log("[27] SPA domain:", JSON.stringify(domain));

  for (let i = 0; i < domain.length; i++) {
    const body = await captureSubArea(embed, i, domain.length);
    if (!body) {
      console.log(`[27] index ${i} (${domain[i]}): NO RESPONSE`);
      continue;
    }
    const model = extractPresModel([body]);
    const persons = reconstructWorksheet(model, "Persons by Med-Cal");
    const title = body.match(/Service Planning Area \d+|Unknown/)?.[0] ?? "?";
    console.log(`[27] index ${i} expected=${domain[i]} title=${title} medCalPersons=${JSON.stringify(persons?.rows?.[0])}`);
  }
} finally {
  await embed.close();
}
