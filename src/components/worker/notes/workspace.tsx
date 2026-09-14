"use client";
import BrandLogo from "@/components/layout/brand-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { labelFor } from "@/lib/notes/form";
import { displayShiftTime } from "@/lib/roster/shifts";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  Check,
  ClipboardList,
  Download,
  FileText,
  Mic,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import AccountMenu from "../../layout/account-menu";
import VoicePanel from "../recorder/voice-panel";
import WorkerShifts from "../shifts/worker-shifts";
import NotesHistory from "./notes-history";
import RiskReview from "./risk-review";
import ShiftNoteCard from "./shift-note-card";
import { useWorkspace } from "./use-workspace";
export default function Workspace(props: Parameters<typeof useWorkspace>[0]) {
  const {
    user,
    workflowEnabled,
    router,
    view,
    setView,
    fields,
    note,
    notes,
    loading,
    setLoading,
    busy,
    onSignOutBusyChange,
    voiceActive,
    setVoiceActive,
    error,
    listError,
    reloadOpen,
    setReloadOpen,
    reviewNote,
    setReviewNote,
    recoveryCopy,
    filter,
    setFilter,
    showIssues,
    notice,
    setNotice,
    errorSummary,
    recorderReview,
    dirty,
    validation,
    completed,
    savedRisk,
    loadNotes,
    update,
    acceptSaved,
    persist,
    action,
    savePractice,
    prepareVoiceDraft,
    save,
    openDetails,
    saveBeforeSignOut,
    reviewAndConfirm,
    startNew,
    openNote,
    selectShift,
    download,
    reloadSaved,
    filtered,
  } = useWorkspace(props);

  return (
    <Tabs
      value={view}
      onValueChange={(value) => {
        if (!voiceActive) setView(value);
      }}
      className="workspace-root"
    >
      <header className="topbar">
        <div className="brand">
          <BrandLogo />
          Assura<span className="edition">WORKER</span>
        </div>
        <TabsList className="main-tabs">
          <TabsTrigger value="worker">
            <Mic size={16} /> My shifts
          </TabsTrigger>
          <TabsTrigger value="history" disabled={voiceActive}>
            <ClipboardList size={16} /> My notes
          </TabsTrigger>
        </TabsList>
        {user ? (
          <AccountMenu
            name={user.name}
            role="worker"
            providerName={user.providerName}
            onDetails={() => void openDetails()}
            disabled={voiceActive || Boolean(busy)}
            beforeSignOut={saveBeforeSignOut}
            onBusyChange={onSignOutBusyChange}
          />
        ) : (
          <div className="profile">
            <Link href="/?role=worker">
              Sign in <ArrowUpRight size={15} />
            </Link>
          </div>
        )}
      </header>
      <main className="main-shell">
        <TabsContent value="worker">
          {note && (
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  {note.providerName ?? "Unassigned provider"}
                </p>
                <h1>
                  {completed
                    ? "One shift, all wrapped up."
                    : "Let’s wrap up your shift."}
                </h1>
                <p>
                  {completed
                    ? "Your confirmed record is saved and ready to review."
                    : "Keep the details that matter, while they’re still fresh."}
                </p>
              </div>
              <div className="heading-actions">
                {workflowEnabled && !completed && (
                  <Button
                    disabled={Boolean(busy) || voiceActive}
                    onClick={() =>
                      action("Opening risk conversation", async () => {
                        const saved = await persist();
                        router.push(`/worker/notes/${saved.id}/workflow`);
                      })
                    }
                  >
                    <AudioLines size={16} /> Try risk conversation
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={Boolean(busy) || voiceActive}
                  onClick={startNew}
                >
                  <ArrowLeft size={16} /> Choose another shift
                </Button>
              </div>
            </div>
          )}
          {!user && (
            <div className="info-banner">
              <ShieldCheck size={18} />
              <p>
                <Link href="/?role=worker">Sign in to save your notes.</Link>{" "}
                This preview uses your own workspace records. Use fictional
                participant details.
              </p>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <p>{error}</p>
              {note && (
                <Button
                  variant="outline"
                  disabled={Boolean(busy) || voiceActive}
                  onClick={() => setReloadOpen(true)}
                >
                  Reload saved version
                </Button>
              )}
            </div>
          )}
          {recoveryCopy && (
            <div className="info-banner">
              <FileText size={18} />
              <p>
                Your previous unsaved answers are available as a copy until you
                leave this page.
              </p>
              <Button variant="outline" onClick={() => download(recoveryCopy)}>
                Download previous edits
              </Button>
            </div>
          )}
          {notice && (
            <div className="success-banner" role="status">
              <Check size={18} />
              <p>{notice}</p>
            </div>
          )}
          {!note ? (
            <WorkerShifts
              busy={Boolean(busy)}
              onSelect={(shift) => void selectShift(shift)}
            />
          ) : (
            <>
              {note.shiftId && (
                <div className="scheduled-note-details">
                  <strong>{note.fields.participant} · Scheduled shift</strong>
                  <p>
                    Expected: {displayShiftTime(note.expectedStart ?? "")} —{" "}
                    {displayShiftTime(note.expectedEnd ?? "")} · Melbourne
                  </p>
                  <p id="scheduled-participant-help">
                    The participant is set by your manager. Record the actual
                    start and end times below.
                  </p>
                </div>
              )}
              <div className="editor-grid">
                <aside className="conversation-card">
                  <div className="panel-heading">
                    <AudioLines size={20} />
                    <span>Your conversation</span>
                    <span className="quiet-badge">
                      {voiceActive
                        ? "Connected"
                        : completed
                          ? "Note complete"
                          : "English"}
                    </span>
                  </div>
                  <VoicePanel
                    signedIn={Boolean(user)}
                    disabled={Boolean(busy)}
                    note={note}
                    prepareDraft={prepareVoiceDraft}
                    onSaved={acceptSaved}
                    onActive={setVoiceActive}
                    reviewControl={recorderReview}
                  />
                  {completed && !voiceActive && (
                    <div className="voice-download">
                      <Button
                        className="voice-button"
                        onClick={() => download()}
                      >
                        <Download size={18} />
                        Download note
                      </Button>
                    </div>
                  )}
                  <div className="coverage">
                    <div>
                      <span>
                        {completed ? "Record complete" : "Details covered"}
                      </span>
                      <strong>
                        {validation.answered}
                        <span> / {validation.total}</span>
                      </strong>
                    </div>
                    <Progress
                      value={Math.max(
                        0,
                        (validation.answered / validation.total) * 100,
                      )}
                      aria-label="Details covered"
                      className="coverage-bar"
                    />
                    {!completed && validation.issues.length > 0 && (
                      <p>
                        {Array.from(
                          new Set(
                            validation.issues.map((issue) =>
                              labelFor(issue.field),
                            ),
                          ),
                        )
                          .slice(0, 3)
                          .join(" · ")}
                        {validation.issues.length > 3 ? " …" : ""}
                      </p>
                    )}
                    {!completed && validation.ready && (
                      <p>The shift details are ready for your review.</p>
                    )}
                  </div>
                  <div className="conversation-footer">
                    <ShieldCheck size={17} />
                    <span>
                      {completed
                        ? "Your confirmed account and saved check are shown below."
                        : "You review and confirm before a note is completed."}
                    </span>
                  </div>
                </aside>
                <ShiftNoteCard
                  note={note}
                  completed={completed}
                  showIssues={showIssues}
                  validation={validation}
                  errorSummary={errorSummary}
                  fields={fields}
                  savedRisk={savedRisk}
                  update={update}
                  busy={busy}
                  voiceActive={voiceActive}
                  user={user}
                  savePractice={savePractice}
                  dirty={dirty}
                  setReviewNote={setReviewNote}
                  setView={setView}
                  save={save}
                  reviewAndConfirm={reviewAndConfirm}
                />
              </div>
            </>
          )}
        </TabsContent>
        <NotesHistory
          busy={busy}
          voiceActive={voiceActive}
          startNew={startNew}
          notes={notes}
          filter={filter}
          setFilter={setFilter}
          listError={listError}
          error={error}
          loading={loading}
          setLoading={setLoading}
          loadNotes={loadNotes}
          filtered={filtered}
          user={user}
          setView={setView}
          openNote={openNote}
        />
      </main>
      <footer className="site-footer">
        <span>Assura</span>
        <span>Demo workspace · Use fictional participant details</span>
      </footer>
      {reviewNote && (
        <RiskReview
          key={`${reviewNote.id}:${reviewNote.revision}`}
          note={reviewNote}
          onClose={() => setReviewNote(null)}
          onReload={(saved) => {
            acceptSaved(saved);
            setReviewNote(saved);
          }}
          onSaved={(saved) => {
            acceptSaved(saved);
            setReviewNote(null);
            setNotice("Your shift note is complete.");
          }}
        />
      )}
      <Dialog
        open={reloadOpen}
        onOpenChange={(open) => {
          if (!busy) setReloadOpen(open);
        }}
      >
        <DialogContent>
          <DialogTitle>Load the latest saved version?</DialogTitle>
          <DialogDescription>
            Your unsaved answers will be kept on this page as a downloadable
            copy. Loading a saved version will not save or overwrite anything.
          </DialogDescription>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={Boolean(busy) || voiceActive}
              onClick={() => setReloadOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              disabled={Boolean(busy) || voiceActive}
              onClick={reloadSaved}
            >
              Load saved version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
