import Fastify from "fastify";
import { verifyManifest } from "./bootstrap/verifyManifest";
import writeRoute from "./routes/write";

// Bootstrap: verify build manifest using ENGINE_PUBKEY_HEX
const enginePubKeyHex = process.env.ENGINE_PUBKEY_HEX;
// If multi-key quorum env is provided, single key is optional
verifyManifest(enginePubKeyHex ? Buffer.from(enginePubKeyHex, "hex") : undefined);

const app = Fastify();
app.register(writeRoute);
// other routes can be registered here

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`chittysync engine listening on :${port}`);
});
