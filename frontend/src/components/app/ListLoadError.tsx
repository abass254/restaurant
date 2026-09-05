"use client";

type ListLoadErrorProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ListLoadError({
  title = "Could not load this list",
  message,
  onRetry,
}: ListLoadErrorProps) {
  return (
    <div className="inventory-empty inventory-empty--error" role="alert">
      <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
