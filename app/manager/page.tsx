import Link from "next/link";
import { AudioLines, ShieldCheck } from "lucide-react";
import { getChatGPTUser } from "../chatgpt-auth";
import ManagementBoard from "../management-board";
import ThemeToggle from "../theme-toggle";
export const dynamic = "force-dynamic";
export default async function ManagerPage() {
  const user = await getChatGPTUser();
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <AudioLines size={24} />
          </span>
          LegalMate<span className="edition">MANAGER</span>
        </Link>
        <span className="manager-role">
          <ShieldCheck size={16} /> Supervisor workspace
        </span>
        <div className="profile">
          <ThemeToggle />
          {user ? (
            <span>{user.fullName ?? user.email}</span>
          ) : (
            <a href="/signin-with-chatgpt?return_to=/manager" target="_top">
              Sign in
            </a>
          )}
        </div>
      </header>
      <main className="main-shell manager-shell">
        <ManagementBoard signedIn={Boolean(user)} />
      </main>
      <footer className="site-footer">
        <span>LegalMate</span>
        <span>Demo · Your own records · In-app alerts</span>
      </footer>
    </>
  );
}
