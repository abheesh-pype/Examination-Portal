import { NextResponse } from "next/server";
import { clearSessionCookie, revokeSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin)
      || request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
    }
    await revokeSession(request);
    const response = NextResponse.json({ logged_out: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    console.error("Failed to end authenticated session", error);
    return NextResponse.json({ error: "Unable to log out." }, { status: 500 });
  }
}
