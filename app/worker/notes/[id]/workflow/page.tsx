import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth";
import { workflowCaseForNote } from "@/lib/workflow-server";
import WorkflowTest from "@/app/workflow-test";

export const dynamic = "force-dynamic";
export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAppUser();
  if (!user) redirect("/?role=worker");
  let data;
  try {
    data = await workflowCaseForNote((await params).id, user.userId);
  } catch {
    return (
      <main className="workflow-unavailable">
        <h1>Risk conversation unavailable</h1>
        <p>
          Choose an editable shift note before starting a risk conversation.
        </p>
        <Link href="/worker">Back to your shifts</Link>
      </main>
    );
  }
  return (
    <WorkflowTest
      note={data.note}
      initialCase={data.case}
      initialReviewed={data.reviewed}
    />
  );
}
