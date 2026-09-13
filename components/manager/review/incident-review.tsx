"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { when, type Incident } from "./management-data";
export default function ReviewForm({
  item,
  onSave,
}: {
  item: Incident;
  onSave: (body: Record<string, string>) => Promise<void>;
}) {
  const [details, setDetails] = useState({
    eventAt: "",
    providerBecameAwareAt: "",
    commissionNotifiedAt: "",
    awarenessSource: "",
    comment: "",
    assessment: "Needs review",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave({
        ...details,
        ...Object.fromEntries(
          ["eventAt", "providerBecameAwareAt", "commissionNotifiedAt"].map(
            (key) => [
              key,
              details[key as keyof typeof details]
                ? new Date(details[key as keyof typeof details]).toISOString()
                : "",
            ],
          ),
        ),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="review-form">
      <p className="section-help">
        Enter observed or evidenced times, using your device’s local timezone.
        Leave unknown times empty. Earlier provider awareness is preserved.
      </p>
      {(
        [
          ["eventAt", "Event time"],
          ["providerBecameAwareAt", "Provider first became aware"],
          [
            "commissionNotifiedAt",
            "Commission notified externally — if already done",
          ],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <Input
            type="datetime-local"
            value={details[key]}
            onChange={(e) => setDetails({ ...details, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Who became aware, and how is the time known?
        <Input
          value={details.awarenessSource}
          onChange={(e) =>
            setDetails({ ...details, awarenessSource: e.target.value })
          }
        />
      </label>
      <label>
        Supervisor assessment
        <Select
          value={details.assessment}
          onValueChange={(assessment) => setDetails({ ...details, assessment })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              "Needs review",
              "Reportable — supervisor assessed",
              "Not reportable — supervisor assessed",
            ].map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label>
        Facts, disagreement or reason for assessment
        <Textarea
          value={details.comment}
          onChange={(e) => setDetails({ ...details, comment: e.target.value })}
        />
      </label>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <Button disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Add review entry"}
      </Button>
      <details>
        <summary>{item.history.length} previous review entries</summary>
        {item.history.map((entry, index) => (
          <p key={index}>
            {when(entry.created_at)} ·{" "}
            {entry.details.comment ||
              entry.details.assessment ||
              entry.details.awarenessSource}
          </p>
        ))}
      </details>
    </div>
  );
}
