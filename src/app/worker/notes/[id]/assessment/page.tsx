import { redirect } from "next/navigation";

// Keep old bookmarks useful without starting a check or a separate interview.
export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/worker?note=${encodeURIComponent(id)}`);
}
