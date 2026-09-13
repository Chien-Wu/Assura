"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { riskTypeLabels } from "@/lib/assessment/result";
import { noteText } from "@/lib/notes/form";
import { Download } from "lucide-react";
import InterviewReferences from "../../worker/notes/interview-references";
import { RiskBadge } from "./finding-review";
import { download, when, type Audit } from "./management-data";
export default function AuditDialog({
  audit,
  setAudit,
}: {
  audit: Audit | null;
  setAudit: (value: Audit | null) => void;
}) {
  return (
    <Dialog
      open={Boolean(audit)}
      onOpenChange={(value) => {
        if (!value) setAudit(null);
      }}
    >
      <DialogContent className="management-dialog audit-dialog">
        <DialogTitle>Original evidence & review history</DialogTitle>
        <DialogDescription>
          The original conversation protects what the worker disclosed. Note
          edits cannot change it.
        </DialogDescription>
        {audit && (
          <>
            <Button
              variant="outline"
              onClick={() =>
                download(audit, `shift-${audit.note.id}-incident-evidence.json`)
              }
            >
              <Download size={16} />
              Download evidence bundle
            </Button>
            <div className="audit-scroll">
              <p>
                Retention minimum: {when(audit.retention.minimumUntil)}.{" "}
                {audit.retention.extendedRetention}
              </p>
              <h3>Original generated note · draft_v0</h3>
              <pre>
                {audit.draftV0
                  ? noteText(audit.draftV0)
                  : "Not prepared for review yet. The captured transcript is already retained."}
              </pre>
              <InterviewReferences note={audit.note} />
              <h3>Current saved note</h3>
              <pre>{noteText(audit.note)}</pre>
              {audit.assessment && (
                <>
                  <h3>Risk check · {audit.assessment.status}</h3>
                  <p>
                    {audit.assessment.result?.summary ??
                      "Risk check not finished."}
                  </p>
                  {audit.assessment.result?.risks.map((risk) => (
                    <article key={risk.type}>
                      <strong>{riskTypeLabels[risk.type]}</strong>{" "}
                      <RiskBadge level={risk.level} />
                      {risk.evidence.map((evidence, index) => (
                        <blockquote key={index}>
                          {evidence.quote}
                          <small>Source: {evidence.sourceId}</small>
                        </blockquote>
                      ))}
                    </article>
                  ))}
                </>
              )}
              {!!audit.findings?.length && (
                <>
                  <h3>Manager finding reviews · all note versions</h3>
                  {audit.findings.map((finding) => (
                    <article key={finding.id}>
                      <strong>
                        {riskTypeLabels[finding.type]} · original AI{" "}
                        {finding.aiLevel} · note version{" "}
                        {finding.sourceRevision}
                      </strong>
                      <p>
                        {finding.reviewStatus}
                        {finding.managerLevel
                          ? ` · manager level ${finding.managerLevel}`
                          : " · AI level retained"}
                      </p>
                      {finding.history.map((action) => (
                        <p key={action.id}>
                          {when(action.createdAt)} · {action.actorName} ·{" "}
                          {action.status}
                          {action.managerLevel
                            ? ` · ${action.managerLevel}`
                            : ""}
                          <br />
                          {action.comment}
                        </p>
                      ))}
                    </article>
                  ))}
                </>
              )}
              {audit.assessmentAudit
                ?.filter((item) => item.schemaVersion === 1)
                .map((item) => (
                  <details key={item.id}>
                    <summary>
                      Earlier AI assessment and conversation · note version{" "}
                      {item.sourceRevision}
                    </summary>
                    <p>{item.result?.summary}</p>
                    {item.result?.concerns?.map((concern) => (
                      <article key={concern.id}>
                        <strong>
                          {concern.priority} · {concern.title}
                        </strong>
                        <p>{concern.whatHappened}</p>
                        {concern.evidence.map((source, index) => (
                          <blockquote key={index}>
                            {source.quote}
                            <small>{source.sourceId}</small>
                          </blockquote>
                        ))}
                      </article>
                    ))}
                    {item.messages.map((message) => (
                      <article key={message.id}>
                        <small>
                          {message.role === "user"
                            ? "Worker"
                            : "Earlier AI assistant"}{" "}
                          · {when(message.createdAt)}
                        </small>
                        <p>{message.text}</p>
                      </article>
                    ))}
                  </details>
                ))}
              <h3>Append-only transcript</h3>
              {audit.transcript.length ? (
                audit.transcript.map((turn) => (
                  <article key={turn.session_id + turn.sequence}>
                    <small>
                      {when(turn.received_at)} ·{" "}
                      {turn.role === "user"
                        ? "Worker"
                        : turn.role === "agent"
                          ? "Assistant"
                          : "Interruption"}
                    </small>
                    <p>{turn.content}</p>
                  </article>
                ))
              ) : (
                <p>
                  No immutable session events exist for this record. It may
                  predate this capture feature.
                </p>
              )}
              <h3>Every saved change</h3>
              {audit.changes.map((change, index) => (
                <article key={index}>
                  <strong>
                    {change.field.replaceAll("_", " ")} · revision{" "}
                    {change.revision}
                  </strong>
                  <small>
                    {when(change.created_at)} · {change.source} · actor{" "}
                    {change.actor}
                  </small>
                  <div className="audit-diff">
                    <pre>
                      {JSON.parse(change.before_value) ?? "Not recorded"}
                    </pre>
                    <span>→</span>
                    <pre>
                      {JSON.parse(change.after_value) ?? "Not recorded"}
                    </pre>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
