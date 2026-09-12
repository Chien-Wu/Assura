import {
  AudioLines,
  ArrowUpRight,
  ClipboardCheck,
  MessagesSquare,
  ShieldCheck,
  History,
  BellRing,
} from "lucide-react";
import ThemeToggle from "./theme-toggle";

export default function Home() {
  return (
    <div className="launch">
      <div className="launch-aura" aria-hidden="true" />
      <header className="launch-bar">
        <span className="brand brand-on-deep">
          <span className="brand-icon">
            <AudioLines size={21} aria-hidden="true" />
          </span>
          LegalMate
        </span>
        <span className="launch-bar-end">
          <span className="demo-chip">Demo workspace</span>
          <ThemeToggle />
        </span>
      </header>

      <main className="launch-main">
        <p className="eyebrow eyebrow-on-deep">Shift documentation</p>
        <h1 className="launch-title">
          A clear handover.
          <br />
          <span>A better next shift.</span>
        </h1>
        <p className="launch-lede">
          Talk or type through the shift once. LegalMate captures what was
          stated, marks what still needs review, and keeps the evidence intact.
        </p>

        <div className="launch-cards">
          <a
            className="launch-card is-primary"
            href="/worker"
            target="_blank"
            rel="noopener"
          >
            <span className="launch-card-icon">
              <MessagesSquare size={22} aria-hidden="true" />
            </span>
            <span className="eyebrow">Support worker</span>
            <h2>Wrap up your shift</h2>
            <p>
              Talk or type through the shift, review the captured details, and
              confirm your note.
            </p>
            <strong>
              Open worker workspace
              <ArrowUpRight size={17} aria-hidden="true" />
            </strong>
          </a>
          <a
            className="launch-card"
            href="/manager"
            target="_blank"
            rel="noopener"
          >
            <span className="launch-card-icon">
              <ClipboardCheck size={22} aria-hidden="true" />
            </span>
            <span className="eyebrow">Manager</span>
            <h2>See what needs attention</h2>
            <p>
              Review alerts, inspect the original conversation, and record
              supervisor decisions.
            </p>
            <strong>
              Open manager board
              <ArrowUpRight size={17} aria-hidden="true" />
            </strong>
          </a>
        </div>

        <ul className="launch-points">
          <li>
            <ShieldCheck size={17} aria-hidden="true" />
            Append-only transcript and evidence
          </li>
          <li>
            <History size={17} aria-hidden="true" />
            Confirmation tied to the exact note revision
          </li>
          <li>
            <BellRing size={17} aria-hidden="true" />
            Alerts stay in the app — nothing is sent externally
          </li>
        </ul>

        <p className="launch-note">
          Both demo windows use your current sign-in and saved records. Separate
          staff accounts and team permissions are not configured. Use fictional
          participant details.
        </p>
      </main>
    </div>
  );
}
