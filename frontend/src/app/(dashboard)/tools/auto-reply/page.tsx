"use client";

import { useEffect, useState } from "react";
import { ListSkeleton } from "@/components/app/LoadingStates";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";

type Rule = {
  id: number;
  name: string;
  trigger_phrase: string;
  match_type: string;
  is_active: boolean;
};

export default function AutoReplyPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ rules: Rule[] }>(apiRoutes.autoReply)
      .then((data) => setRules(data.rules))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load rules.");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="app-panel">
      <h1 className="app-title">Auto-reply rules</h1>
      <p className="app-lead">Automatic responses when customer messages match a trigger phrase.</p>
      <p className="app-muted">
        Tip: use <code>{"{username}"}</code> in a reply to greet the customer by their Instagram
        handle (e.g. <em>Hello @amina</em>). It falls back to <em>there</em> when the handle isn't
        known yet.
      </p>
      {error ? <p className="app-error">{error}</p> : null}
      {loading ? (
        <ListSkeleton items={5} />
      ) : (
        <ul className="app-list">
          {rules.map((rule) => (
            <li key={rule.id}>
              <strong>{rule.name}</strong>
              <span>
                {rule.match_type}: {rule.trigger_phrase}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
