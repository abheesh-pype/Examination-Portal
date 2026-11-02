// Prints a new RSA signing key for INTEGRATION_SIGNING_KEY (store it in the secret manager; never commit it).
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();
console.log("# INTEGRATION_SIGNING_KEY (single line, \\n escaped):");
console.log(pem.replace(/\n/g, "\\n"));
