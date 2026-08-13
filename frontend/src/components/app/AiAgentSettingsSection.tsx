"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { AiAgentConfig, AiAgentConfigResponse, AiAgentTestResponse } from "@/lib/types";
import { Skeleton } from "./Skeleton";

const DEFAULT_MODEL = "gpt-4o-mini";

type FormState = {
  api_key: string;
  chat_model: string;
};

const EMPTY_FORM: FormState = {
  api_key: "",
  chat_model: DEFAULT_MODEL,
};

export function AiAgentSettingsSection() {
  const [config, setConfig] = useState<AiAgentConfig | null>(null);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [active, setActive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiAgentTestResponse | null>(null);

  useEffect(() => {
    void apiFetch<AiAgentConfigResponse>(apiRoutes.aiAgentConfig)
      .then((data) => {
        setConfig(data.config);
        setEnvConfigured(data.env_configured);
        setActive(data.active);
        if (!data.config) {
          setEditing(true);
        }
      })
      .catch(() => {
        setConfig(null);
        setEnvConfigured(false);
        setActive(false);
      })
      .finally(() => setLoaded(true));
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEdit() {
    if (config) {
      setForm({
        api_key: "",
        chat_model: config.chat_model ?? DEFAULT_MODEL,
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setEditing(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await apiFetch<{ config: AiAgentConfig }>(apiRoutes.aiAgentConfig, {
        method: "PUT",
        body: JSON.stringify({
          api_key: form.api_key.trim(),
          chat_model: form.chat_model.trim() || DEFAULT_MODEL,
        }),
      });
      setConfig(data.config);
      setActive(true);
      setEditing(false);
      await toastSuccess("ChatGPT API key saved");
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const body =
        editing && form.api_key.trim()
          ? {
              api_key: form.api_key.trim(),
              chat_model: form.chat_model.trim() || DEFAULT_MODEL,
            }
          : editing && form.chat_model.trim()
            ? { chat_model: form.chat_model.trim() }
            : {};
      const data = await apiFetch<AiAgentTestResponse>(apiRoutes.aiAgentTest, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setTestResult(data);
      if (data.ok) {
        await toastSuccess("ChatGPT API key verified");
      } else {
        await showError("API key check failed", data.message);
      }
    } catch (err) {
      await showError("Could not test API key", extractErrorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    const ok = await confirmAction(
      "Remove ChatGPT config?",
      "DM and comment agents will fall back to other LLM providers (Gemini, Groq, etc.) unless OPENAI_API_KEY is set in the environment.",
      "Yes, remove",
    );
    if (!ok) return;
    setSaving(true);
    try {
      await apiFetch(apiRoutes.aiAgentConfig, { method: "DELETE" });
      setConfig(null);
      setActive(envConfigured);
      setForm(EMPTY_FORM);
      setEditing(true);
      await toastSuccess("ChatGPT config removed");
    } catch (err) {
      await showError("Could not remove", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <article className="settings-card" aria-busy="true" aria-live="polite">
        <header className="settings-card__head">
          <div className="settings-card__title">
            <i className="fa-solid fa-robot settings-card__icon" aria-hidden="true" />
            <h2>ChatGPT</h2>
          </div>
          <Skeleton variant="text" height={22} width={88} />
        </header>
        <div className="settings-card__body">
          <Skeleton variant="text" height={12} width="90%" />
        </div>
      </article>
    );
  }

  return (
    <article className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-robot settings-card__icon" aria-hidden="true" />
          <h2>ChatGPT</h2>
        </div>
        {config ? (
          <span className="settings-pill settings-pill--ok">Configured</span>
        ) : active ? (
          <span className="settings-pill settings-pill--ok">Active (env)</span>
        ) : (
          <span className="settings-pill settings-pill--warn">Not configured</span>
        )}
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Add your OpenAI API key so Instagram DM and comment agents use ChatGPT instead of
          Gemini. When saved here, OpenAI is used for all AI replies platform-wide.
          {!config && envConfigured ? (
            <>
              {" "}
              A key from <code>OPENAI_API_KEY</code> is active on the server. Save below to
              pin ChatGPT in the database without redeploying.
            </>
          ) : null}
          {!config && !envConfigured ? (
            <>
              {" "}
              Without a key here (or in <code>OPENAI_API_KEY</code>), agents fall back to
              Gemini or other configured providers.
            </>
          ) : null}
        </p>

        {config && !editing ? (
          <>
            <div className="mpesa-summary">
              <div className="mpesa-summary__row">
                <div className="mpesa-summary__cell">
                  <span className="mpesa-summary__label">API key</span>
                  <span className="mpesa-summary__value">
                    <code>{config.api_key_masked ?? "—"}</code>
                  </span>
                </div>
                <div className="mpesa-summary__cell">
                  <span className="mpesa-summary__label">Model</span>
                  <span className="mpesa-summary__value">
                    <code>{config.chat_model ?? DEFAULT_MODEL}</code>
                  </span>
                </div>
                <div className="mpesa-summary__cell">
                  <span className="mpesa-summary__label">Provider</span>
                  <span className="mpesa-summary__value">
                    <code>OpenAI (ChatGPT)</code>
                  </span>
                </div>
              </div>
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleTest()}
                disabled={testing || saving}
              >
                <i className="fa-solid fa-bolt" aria-hidden="true" />
                {testing ? "Testing…" : "Test API key"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>
                <i className="fa-solid fa-pen" aria-hidden="true" />
                Edit
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                onClick={() => void handleDelete()}
                disabled={saving}
              >
                <i className="fa-solid fa-trash" aria-hidden="true" />
                Remove
              </button>
            </div>
            {testResult ? (
              <p
                className={`settings-card__hint settings-pill settings-pill--${
                  testResult.ok ? "ok" : "warn"
                }`}
              >
                {testResult.message}
              </p>
            ) : null}
          </>
        ) : null}

        {editing ? (
          <form
            className="settings-form settings-form--compact"
            onSubmit={(e) => void handleSubmit(e)}
          >
            <label className="settings-field">
              <span>OpenAI API key</span>
              <input
                type="password"
                required
                value={form.api_key}
                onChange={(e) => update("api_key", e.target.value)}
                placeholder={config ? "Enter to replace stored key" : "sk-…"}
                autoComplete="off"
              />
            </label>
            <label className="settings-field">
              <span>Chat model</span>
              <input
                type="text"
                value={form.chat_model}
                onChange={(e) => update("chat_model", e.target.value)}
                placeholder={DEFAULT_MODEL}
              />
            </label>
            <div className="settings-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void handleTest()}
                disabled={testing || saving || !form.api_key.trim()}
              >
                {testing ? "Testing…" : "Test before save"}
              </button>
              {config ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(false);
                    setForm(EMPTY_FORM);
                  }}
                  disabled={saving}
                >
                  Cancel
                </button>
              ) : null}
            </div>
            {testResult ? (
              <p
                className={`settings-card__hint settings-pill settings-pill--${
                  testResult.ok ? "ok" : "warn"
                }`}
              >
                {testResult.message}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </article>
  );
}
