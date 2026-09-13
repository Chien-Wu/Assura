import { failure, identity, json, readBody } from "@/lib/notes-server";
import { getOnboarding, saveWorkerProfile } from "@/lib/organisations";

export async function GET(request: Request) {
  try {
    const user = await identity(request);
    return json({ user, ...(await getOnboarding(user)) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const body = await readBody(request);
    await saveWorkerProfile(user, body.fullName, body.providerId);
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
