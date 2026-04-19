import { NextResponse } from "next/server";

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const BASE_URL = "https://graph.facebook.com/v19.0";

export async function POST(request: Request) {
  try {
    const { campaignId, status } = await request.json();
    if (!campaignId || !status) {
      return NextResponse.json({ error: "Missing campaignId or status" }, { status: 400 });
    }

    const allowed = ["ACTIVE", "PAUSED"];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const res: Response = await fetch(`${BASE_URL}/${campaignId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: ACCESS_TOKEN!, status }),
    });
    const data = await res.json();

    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
