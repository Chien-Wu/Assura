"use client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type ConversationMode, type VoiceEvent } from "@/lib/recorder/state";
import { ConversationProvider } from "@elevenlabs/react";
import {
  Check,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Send,
} from "lucide-react";
import { useState } from "react";
import { useVoiceRecorder, type Props } from "./use-voice-recorder";
export default function VoicePanel(props: Props) {
  const [attempt, setAttempt] = useState({
    key: 0,
    error: "",
    messages: [] as VoiceEvent[],
  });
  const [selectedMode, setSelectedMode] = useState<ConversationMode>("text");
  const [running, setRunning] = useState(false);
  return (
    <>
      <div
        className="conversation-mode"
        role="group"
        aria-label="Conversation mode"
      >
        <Button
          variant="ghost"
          disabled={running}
          aria-pressed={selectedMode === "text"}
          onClick={() => setSelectedMode("text")}
        >
          <MessageSquare size={16} />
          Text · Test mode
        </Button>
        <Button
          variant="ghost"
          disabled={running}
          aria-pressed={selectedMode === "voice"}
          onClick={() => setSelectedMode("voice")}
        >
          <Mic size={16} />
          Voice
        </Button>
      </div>
      <ConversationProvider key={attempt.key}>
        <VoiceControls
          {...props}
          selectedMode={selectedMode}
          initialError={attempt.error}
          initialMessages={attempt.messages}
          onActive={(value) => {
            setRunning(value);
            props.onActive(value);
          }}
          onReset={(error, messages) =>
            setAttempt((old) =>
              old.key === attempt.key
                ? { key: old.key + 1, error, messages }
                : old,
            )
          }
        />
      </ConversationProvider>
    </>
  );
}
function VoiceControls(props: Parameters<typeof useVoiceRecorder>[0]) {
  const {
    signedIn,
    disabled,
    note,
    textOnly,
    available,
    phase,
    error,
    messages,
    input,
    setInput,
    sending,
    waiting,
    transcript,
    stop,
    sendText,
    conversation,
    start,
  } = useVoiceRecorder(props);

  return (
    <div className={`voice-intro voice-live ${textOnly ? "text-mode" : ""}`}>
      <div
        className={`mic-symbol ${note?.status === "complete" ? "done" : ""}`}
        data-phase={note?.status === "complete" ? "done" : phase}
      >
        {note?.status === "complete" ? (
          <Check size={35} />
        ) : textOnly ? (
          <MessageSquare size={32} />
        ) : (
          <Mic size={35} />
        )}
      </div>
      <h2>
        {phase === "starting"
          ? "Connecting…"
          : note?.status === "complete"
            ? "Your note is saved."
            : textOnly
              ? "Type through your shift."
              : phase === "active"
                ? conversation.isSpeaking
                  ? "Your assistant is speaking"
                  : "Tell me about your shift"
                : "Let’s talk through your shift."}
      </h2>
      <p>
        {note?.status === "complete"
          ? "Your confirmed note is ready in Review notes."
          : textOnly
            ? "Your messages and the assistant’s questions are recorded and retained with your note. The original transcript protects what you disclosed, even if the note is edited."
            : phase === "active"
              ? "Your account is saved as you speak. Select End conversation & review when you are ready."
              : "This conversation’s transcript is recorded and retained with your note, protecting what you disclosed if the note is edited. Audio is sent to ElevenLabs. Use fictional details."}
      </p>
      {phase === "idle" ? (
        <Button
          className="voice-button"
          disabled={
            !available || !signedIn || disabled || note?.status === "complete"
          }
          onClick={start}
        >
          {textOnly ? <MessageSquare size={18} /> : <Mic size={18} />}{" "}
          {textOnly ? "Start text note" : "Start voice note"}
        </Button>
      ) : (
        <div className="call-buttons">
          <Button
            className="voice-button"
            disabled={phase === "stopping"}
            onClick={stop}
          >
            <PhoneOff size={17} />
            {phase === "stopping"
              ? "Ending…"
              : textOnly
                ? "End conversation"
                : "End call"}
          </Button>
          {!textOnly && phase === "active" && (
            <Button
              variant="outline"
              className="voice-button"
              onClick={() => conversation.setMuted(!conversation.isMuted)}
              aria-label={
                conversation.isMuted ? "Unmute microphone" : "Mute microphone"
              }
            >
              {conversation.isMuted ? <MicOff size={17} /> : <Mic size={17} />}
            </Button>
          )}
        </div>
      )}
      <p className="voice-caption" aria-live="polite">
        {phase === "starting" ? (
          <>
            <LoaderCircle className="spin inline" size={14} /> Connecting
            securely
          </>
        ) : phase === "stopping" ? (
          "Finishing saved updates…"
        ) : phase === "active" ? (
          textOnly ? (
            waiting ? (
              "Waiting for the assistant…"
            ) : (
              "Connected · Type below"
            )
          ) : conversation.isMuted ? (
            "Microphone muted"
          ) : (
            "Call connected"
          )
        ) : available === null ? (
          "Checking connection…"
        ) : !available ? (
          "Conversation setup pending"
        ) : !signedIn ? (
          "Sign in to start"
        ) : textOnly ? (
          "English · No microphone needed · Use fictional details"
        ) : (
          "English · Up to 10 minutes per call"
        )}
      </p>
      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}
      {messages.length > 0 && (
        <div
          className="voice-transcript"
          ref={transcript}
          role="log"
          aria-label="Conversation transcript"
          aria-live="polite"
        >
          {messages.map((message) => (
            <p key={message.sequence} data-kind={message.kind}>
              <strong>{message.kind === "user" ? "You" : "Assistant"}</strong>
              {message.text}
            </p>
          ))}
        </div>
      )}
      {textOnly && phase === "active" && note?.status !== "complete" && (
        <form
          className="text-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendText();
          }}
        >
          <label htmlFor="conversation-message">Your message</label>
          <Textarea
            id="conversation-message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={6000}
            rows={3}
            disabled={sending}
            placeholder="Tell me about your shift…"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void sendText();
              }
            }}
          />
          <div>
            <span>Enter to send · Shift + Enter for a new line</span>
            <Button
              type="submit"
              className="voice-button"
              disabled={sending || waiting || !input.trim()}
            >
              {sending ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Send size={16} />
              )}
              Send
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
