"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { InventoryIntegrationConfig, SettingsResponse } from "@/lib/types";
import { SkeletonText } from "./Skeleton";

const DEFAULT_CONFIG: InventoryIntegrationConfig = {
  catalog_source: "platform",
  external: null,
};

export function InventoryIntegrationSection() {
  const [config, setConfig] = useState<InventoryIntegrationConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testQuery, setTestQuery] = useState("test");
  const [testResults, setTestResults] = useState<
    { name: string; price_kes: number; stock: number | null; source: string }[]
  >([]);

  useEffect(() => {
    void apiFetch<SettingsResponse>(apiRoutes.settings)
      .then((data) => {
        if (data.inventory_integration) {
          setConfig(data.inventory_integration);
        }
      })
      .catch(() => {
        setConfig(DEFAULT_CONFIG);
      })
      .finally(() => setLoaded(true));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (
      (config.catalog_source === "external" || config.catalog_source === "hybrid") &&
      !config.external?.base_url?.trim()
    ) {
      showError("Enter the external API base URL.");
      return;
    }

    setSaving(true);
    try {
      const data = await apiFetch<{ inventory_integration: InventoryIntegrationConfig }>(
        apiRoutes.settingsInventoryIntegration,
        {
          method: "PATCH",
          body: JSON.stringify(config),
        },
      );
      setConfig(data.inventory_integration);
      toastSuccess("Inventory source saved.");
    } catch (err) {
      showError(extractErrorMessage(err, "Could not save inventory integration."));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResults([]);
    try {
      const data = await apiFetch<{
        products: { name: string; price_kes: number; stock: number | null; source: string }[];
      }>(apiRoutes.settingsInventoryIntegrationTest, {
        method: "POST",
        body: JSON.stringify({ query: testQuery.trim() || "test" }),
      });
      setTestResults(data.products ?? []);
      toastSuccess(`Found ${data.products?.length ?? 0} product(s).`);
    } catch (err) {
      showError(extractErrorMessage(err, "Catalog test failed."));
    } finally {
      setTesting(false);
    }
  }

  if (!loaded) {
    return <SkeletonText lines={4} />;
  }

  const external = config.external ?? {
    type: "http",
    base_url: "",
    auth: { type: "none" },
    endpoints: {},
    field_map: {},
    cache_ttl_seconds: 60,
    browse_only: false,
  };

  return (
    <article id="section-inventory" className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-boxes-stacked settings-card__icon" aria-hidden="true" />
          <h2>Inventory source</h2>
        </div>
      </header>
      <form className="settings-card__body" onSubmit={(event) => void handleSubmit(event)}>
        <p className="settings-muted">
          Choose where duKAi reads product prices and stock. Platform inventory uses your duKAi
          catalogue; external connects to your existing ERP or POS API (read-through).
        </p>

        <label className="settings-field">
          <span>Catalog source</span>
          <select
            value={config.catalog_source}
            onChange={(event) =>
              setConfig((prev) => ({
                ...prev,
                catalog_source: event.target.value as InventoryIntegrationConfig["catalog_source"],
              }))
            }
          >
            <option value="platform">Use duKAi inventory</option>
            <option value="external">Connect existing inventory (API)</option>
            <option value="hybrid">Hybrid (platform + external)</option>
          </select>
        </label>

        {config.catalog_source !== "platform" ? (
          <div className="settings-stack">
            <label className="settings-field">
              <span>API base URL</span>
              <input
                type="url"
                value={external.base_url}
                placeholder="https://erp.example.com/api"
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    external: { ...external, base_url: event.target.value },
                  }))
                }
              />
            </label>

            <label className="settings-field">
              <span>Auth type</span>
              <select
                value={external.auth?.type ?? "none"}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    external: {
                      ...external,
                      auth: { ...external.auth, type: event.target.value },
                    },
                  }))
                }
              >
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
                <option value="basic">Basic auth</option>
                <option value="header">Custom header</option>
              </select>
            </label>

            {external.auth?.type === "bearer" ? (
              <label className="settings-field">
                <span>Bearer token</span>
                <input
                  type="password"
                  value={external.auth.token ?? ""}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      external: {
                        ...external,
                        auth: { ...external.auth, token: event.target.value },
                      },
                    }))
                  }
                />
              </label>
            ) : null}

            {external.auth?.type === "basic" ? (
              <>
                <label className="settings-field">
                  <span>Username</span>
                  <input
                    value={external.auth.username ?? ""}
                    onChange={(event) =>
                      setConfig((prev) => ({
                        ...prev,
                        external: {
                          ...external,
                          auth: { ...external.auth, username: event.target.value },
                        },
                      }))
                    }
                  />
                </label>
                <label className="settings-field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={external.auth.password ?? ""}
                    onChange={(event) =>
                      setConfig((prev) => ({
                        ...prev,
                        external: {
                          ...external,
                          auth: { ...external.auth, password: event.target.value },
                        },
                      }))
                    }
                  />
                </label>
              </>
            ) : null}

            <label className="settings-field">
              <span>Search endpoint</span>
              <input
                value={external.endpoints?.search ?? ""}
                placeholder="/products/search?q={query}"
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    external: {
                      ...external,
                      endpoints: { ...external.endpoints, search: event.target.value },
                    },
                  }))
                }
              />
            </label>

            <label className="settings-field">
              <span>List endpoint</span>
              <input
                value={external.endpoints?.list ?? ""}
                placeholder="/products"
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    external: {
                      ...external,
                      endpoints: { ...external.endpoints, list: event.target.value },
                    },
                  }))
                }
              />
            </label>

            <label className="settings-field">
              <span>Get product endpoint</span>
              <input
                value={external.endpoints?.get ?? ""}
                placeholder="/products/{sku}"
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    external: {
                      ...external,
                      endpoints: { ...external.endpoints, get: event.target.value },
                    },
                  }))
                }
              />
            </label>

            <label className="settings-field">
              <span>Create order endpoint</span>
              <input
                value={external.endpoints?.create_order ?? ""}
                placeholder="/orders"
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    external: {
                      ...external,
                      endpoints: { ...external.endpoints, create_order: event.target.value },
                    },
                  }))
                }
              />
            </label>

            <label className="settings-toggle settings-toggle--compact">
              <div className="settings-toggle__copy">
                <strong>Browse only</strong>
                <span>Show external products but hand off orders to your team.</span>
              </div>
              <input
                type="checkbox"
                checked={Boolean(external.browse_only)}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    external: { ...external, browse_only: event.target.checked },
                  }))
                }
              />
            </label>
          </div>
        ) : null}

        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save inventory source"}
          </button>
        </div>

        {config.catalog_source !== "platform" ? (
          <div className="settings-stack settings-card__footer">
            <label className="settings-field">
              <span>Test search query</span>
              <input value={testQuery} onChange={(event) => setTestQuery(event.target.value)} />
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={testing}
              onClick={() => void handleTest()}
            >
              {testing ? "Testing…" : "Test catalog connection"}
            </button>
            {testResults.length > 0 ? (
              <ul className="settings-list">
                {testResults.map((item) => (
                  <li key={`${item.source}-${item.name}`}>
                    {item.name} — KES {item.price_kes.toLocaleString()}
                    {item.stock != null ? ` (${item.stock} in stock)` : ""}
                    <span className="settings-muted"> · {item.source}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>
    </article>
  );
}
