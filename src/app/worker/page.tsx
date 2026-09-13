import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth/server";
import { getOnboarding } from "@/lib/roster/organisations-server";
import Workspace from "../../components/worker/notes/workspace";
import { workflowEnabled } from "@/lib/workflow/server";
export const dynamic = "force-dynamic";
export default function WorkerPage() {
  return <WorkerContent />;
}
async function WorkerContent() {
  const user = await getAppUser();
  if (!user) redirect("/?role=worker");
  const data = await getOnboarding(user);
  if (!data.profile) redirect("/onboarding");
  return (
    <Workspace
      workflowEnabled={workflowEnabled()}
      user={{
        name: data.profile.fullName,
        providerName:
          data.providers.find((p) => p.id === data.profile?.providerId)?.name ??
          "Your service provider",
      }}
    />
  );
}
