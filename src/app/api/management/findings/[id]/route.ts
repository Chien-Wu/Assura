import { failure, identity, json, readBody } from "@/lib/shared/server";
import { requireManager } from "@/lib/roster/organisations-server";
import { reviewFinding } from "@/lib/assessment/finding-review-server";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const user = await identity(request);
    const manager = await requireManager(
      user,
      new URL(request.url).searchParams.get("providerId"),
    );
    const { id } = await context.params;
    const finding = await reviewFinding(
      id,
      manager.providerId,
      user.userId,
      user.fullName || user.displayName,
      await readBody(request),
    );
    return json({ ok: true, finding });
  } catch (error) {
    return failure(error);
  }
}
