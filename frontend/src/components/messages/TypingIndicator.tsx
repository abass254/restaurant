type TypingIndicatorProps = {
  aligned?: "in" | "out";
  label?: string;
};

export function TypingIndicator({
  aligned = "in",
  label = "Typing",
}: TypingIndicatorProps) {
  return (
    <div
      className={`chat-bubble-row chat-bubble-row--${aligned === "out" ? "out" : "in"}`}
      aria-live="polite"
    >
      <div className="chat-bubble chat-bubble--typing" aria-label={label}>
        <span className="chat-typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}
