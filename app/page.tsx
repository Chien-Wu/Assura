import {
  AudioLines,
  ArrowUpRight,
  ClipboardCheck,
  MessagesSquare,
} from "lucide-react";
export default function Home() {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <AudioLines size={24} />
          </span>
          LegalMate
        </div>
        <span className="demo-label">Demo workspace</span>
      </header>
      <main className="workspace-launcher">
        <p className="eyebrow">YOUR WORKSPACE</p>
        <h1>
          A clear handover.
          <br />A better next shift.
        </h1>
        <p>
          Choose your workspace. Each opens in its own window so you can test
          both sides together.
        </p>
        <div className="workspace-choices">
          <a href="/worker" target="_blank" rel="noopener">
            <MessagesSquare size={30} />
            <span className="eyebrow">SUPPORT WORKER</span>
            <h2>Wrap up your shift</h2>
            <p>
              Talk or type through the shift, review the captured details, and
              confirm your note.
            </p>
            <strong>
              Open worker workspace <ArrowUpRight size={18} />
            </strong>
          </a>
          <a href="/manager" target="_blank" rel="noopener">
            <ClipboardCheck size={30} />
            <span className="eyebrow">MANAGER</span>
            <h2>See what needs attention</h2>
            <p>
              Review alerts, inspect the original conversation, and record
              supervisor decisions.
            </p>
            <strong>
              Open manager board <ArrowUpRight size={18} />
            </strong>
          </a>
        </div>
        <p className="launch-note">
          Both demo windows use your current sign-in and saved records. Separate
          staff accounts and team permissions are not configured.
        </p>
      </main>
    </>
  );
}
