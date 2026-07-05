/** Spike 30: exercise captureGeoType on SPA and validate names + values. */
import { launchEmbed, captureGeoType, GEO_TYPES } from "../src/embed.ts";
import { extractPresModel, reconstructWorksheet } from "../src/vizql.ts";

const spa = GEO_TYPES.find((g) => g.geoType === "spa")!;
const embed = await launchEmbed({ headless: true });
try {
  for await (const cap of captureGeoType(embed, spa, (m) => console.log("[30]", m))) {
    const model = extractPresModel([cap.responseText]);
    const persons = reconstructWorksheet(model, "Persons by Med-Cal");
    console.log(`[30] ${cap.geoId}: medCalPersons=${JSON.stringify(persons?.rows?.[0])} bytes=${cap.responseText.length}`);
  }
} finally {
  await embed.close();
}
