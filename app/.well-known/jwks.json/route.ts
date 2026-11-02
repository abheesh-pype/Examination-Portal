import { NextResponse } from "next/server";
import { loadIssuerConfig, publicJwk } from "@/lib/integrations/issuer";

export const runtime = "nodejs";

// Public key of the built-in token issuer (empty set when the issuer is not configured).
export async function GET() {
  const config = loadIssuerConfig();
  return NextResponse.json({ keys: config ? [await publicJwk(config)] : [] }, { headers: { "Cache-Control": "public, max-age=300" } });
}
