import { getRow } from "@/lib/notes/server";
import { failure, identity, json } from "@/lib/shared/server";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    await getRow(id, user.userId);
    return json(
      {
        error:
          "AI2 now checks the saved note silently. Voice follow-up has been retired.",
      },
      410,
    );
  } catch (error) {
    return failure(error);
  }
}
