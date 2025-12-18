import { batchVerify } from "./batchVerify";
import { signObjectQuorum } from "./sign";
import fs from "fs";
import path from "path";

async function main() {
  try {
    const att = await batchVerify();
    console.log(`attestations emitted for ${Object.keys(att).length} registries`);

    const keys = process.env.SIGNING_KEYS_HEX
      ? process.env.SIGNING_KEYS_HEX.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    if (keys.length) {
      const signatures = signObjectQuorum(att, keys);
      const outPath = process.env.OUTPUT_SIGNED_PATH || "assets/attestations.signed.json";
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(
        outPath,
        JSON.stringify(
          {
            att,
            signatures,
          },
          null,
          2
        )
      );
      console.log(
        `signed attestations written to ${outPath} with ${signatures.length} signatures`
      );
    }
  } catch (err) {
    console.error("batch verification failed:", err);
    process.exit(1);
  }
}

main();
