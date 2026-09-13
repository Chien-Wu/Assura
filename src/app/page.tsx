import {
  getAppUser,
  getAuthStatus,
  getTestAccountPrefillPassword,
} from "@/lib/auth/server";
import Entry from "../components/auth/entry";
import { contactUrl } from "@/lib/shared/contact-server";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; error?: string }>;
}) {
  const query = await searchParams;
  const user = await getAppUser();
  return (
    <Entry
      user={
        user
          ? { name: user.displayName, email: user.displayEmail ?? user.email }
          : null
      }
      methods={getAuthStatus()}
      testPassword={user ? "" : getTestAccountPrefillPassword()}
      initialRole={
        query.role === "worker" || query.role === "manager" ? query.role : null
      }
      initialError={
        query.error ? "We couldn’t complete sign-in. Please try again." : ""
      }
      contact={contactUrl()}
    />
  );
}
