"use client";

import { useMemo, useState } from "react";
import { formatKsh } from "@/lib/trans-chap-receipt";

export type ProductSoldItem = {
  name: string;
  sku?: string;
  qty: number;
  total_pcs?: number;
  sell_unit?: string;
  unit_factor?: number;
  selling_amount: number;
  buying_amount: number;
  markup: number;
  selling_price: number;
  buying_price: number;
  unit_buying_price?: number;
  markup_percent?: number;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  period: string;
  totalMarkup: number;
  totalSales: number;
  totalCogs: number;
  products: ProductSoldItem[];
};

export function TransChapMarkupModal({
  isOpen,
  onClose,
  period,
  totalMarkup,
  totalSales,
  totalCogs,
  products,
}: Props) {
  const [search, setSearch] = useState("");

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)),
    );
  }, [products, search]);

  if (!isOpen) return null;

  return (
    <div
      className="trans-chap-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trans-chap-markup-title"
    >
      <div
        className="trans-chap-modal trans-chap-modal--wide"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "600px",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header className="trans-chap-modal__header" style={{ paddingBottom: "0.85rem" }}>
          <div>
            <h3 id="trans-chap-markup-title" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span
                style={{
                  display: "inline-block",
                  width: "10px",
                  height: "10px",
                  borderRadius: "3px",
                  background: "var(--trans-chap-markup, #10b981)",
                }}
              />
              Mark up breakdown
            </h3>
            <p>
              {period} · Products sold and profit earned
            </p>
          </div>
          <button
            type="button"
            className="trans-chap-modal__close"
            onClick={onClose}
            aria-label="Close modal"
          >
            <i className="fa-solid fa-xmark" aria-hidden />
          </button>
        </header>

        {/* Highlight Summary Stats */}
        <div
          style={{
            padding: "0.85rem 1.25rem",
            background: "color-mix(in srgb, var(--app-bg) 60%, transparent)",
            borderBottom: "1px solid var(--app-border, rgba(255, 255, 255, 0.08))",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "0.6rem",
          }}
        >
          <div
            style={{
              padding: "0.55rem 0.75rem",
              borderRadius: "10px",
              background: "color-mix(in srgb, var(--trans-chap-markup, #10b981) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--trans-chap-markup, #10b981) 30%, transparent)",
            }}
          >
            <div
              style={{
                fontSize: "0.65rem",
                fontWeight: 750,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--trans-chap-markup, #10b981)",
              }}
            >
              Total Mark up
            </div>
            <strong
              style={{
                display: "block",
                fontSize: "1.05rem",
                fontWeight: 800,
                color: "var(--app-text, #ffffff)",
                marginTop: "0.15rem",
              }}
            >
              {formatKsh(totalMarkup)}
            </strong>
          </div>

          <div
            style={{
              padding: "0.55rem 0.75rem",
              borderRadius: "10px",
              background: "color-mix(in srgb, var(--trans-chap-sale) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--trans-chap-sale) 25%, transparent)",
            }}
          >
            <div
              style={{
                fontSize: "0.65rem",
                fontWeight: 750,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--trans-chap-sale)",
              }}
            >
              Total Sales
            </div>
            <strong
              style={{
                display: "block",
                fontSize: "1.05rem",
                fontWeight: 800,
                color: "var(--app-text, #ffffff)",
                marginTop: "0.15rem",
              }}
            >
              {formatKsh(totalSales)}
            </strong>
          </div>

          <div
            style={{
              padding: "0.55rem 0.75rem",
              borderRadius: "10px",
              background: "color-mix(in srgb, var(--app-bg) 75%, transparent)",
              border: "1px solid var(--app-border, rgba(255, 255, 255, 0.1))",
            }}
          >
            <div
              style={{
                fontSize: "0.65rem",
                fontWeight: 750,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--app-text-secondary, #a1a1aa)",
              }}
            >
              Buying Cost
            </div>
            <strong
              style={{
                display: "block",
                fontSize: "1.05rem",
                fontWeight: 800,
                color: "var(--app-text, #ffffff)",
                marginTop: "0.15rem",
              }}
            >
              {formatKsh(totalCogs)}
            </strong>
          </div>
        </div>

        {/* Formula Explainer Strip */}
        <div
          style={{
            padding: "0.45rem 1.25rem",
            background: "color-mix(in srgb, var(--app-bg) 40%, transparent)",
            fontSize: "0.72rem",
            color: "var(--app-text-secondary, #a1a1aa)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--app-border, rgba(255, 255, 255, 0.06))",
          }}
        >
          <span>
            <i className="fa-solid fa-calculator" style={{ marginRight: "0.4rem", opacity: 0.8 }} />
            Formula: <strong>(selling price − (buying price per pc × bulk qty))</strong>
          </span>
          <span style={{ fontSize: "0.7rem", opacity: 0.85 }}>
            {filteredProducts.length} product{filteredProducts.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Search Input (only shown if more than 3 products) */}
        {products.length > 3 ? (
          <div style={{ padding: "0.65rem 1.25rem 0.4rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.45rem 0.75rem",
                background: "color-mix(in srgb, var(--app-bg) 80%, transparent)",
                border: "1px solid var(--app-border, rgba(255, 255, 255, 0.1))",
                borderRadius: "10px",
              }}
            >
              <i className="fa-solid fa-magnifying-glass" style={{ color: "var(--app-text-muted, #71717a)", fontSize: "0.8rem" }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products sold..."
                style={{
                  flex: 1,
                  background: "transparent",
                  border: 0,
                  outline: "none",
                  color: "var(--app-text, #ffffff)",
                  fontSize: "0.82rem",
                }}
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    background: "none",
                    border: 0,
                    color: "var(--app-text-muted, #71717a)",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                  }}
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Products List */}
        <div
          style={{
            flex: 1,
            minHeight: "150px",
            overflowY: "auto",
            padding: "0.65rem 1.25rem 1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.55rem",
          }}
        >
          {filteredProducts.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "2.5rem 1rem",
                color: "var(--app-text-secondary, #a1a1aa)",
                fontSize: "0.85rem",
              }}
            >
              <i
                className="fa-solid fa-basket-shopping"
                style={{ fontSize: "2rem", marginBottom: "0.5rem", opacity: 0.4, display: "block" }}
              />
              {search ? "No products matching your search." : `No products sold ${period.toLowerCase()}.`}
            </div>
          ) : (
            filteredProducts.map((p, idx) => {
              const hasBuyingPrice = p.buying_price > 0;
              const isBulk = Boolean(
                (p.unit_factor && p.unit_factor > 1) ||
                (p.total_pcs && p.total_pcs > p.qty),
              );
              const totalPcs = p.total_pcs || (p.qty * (p.unit_factor || 1));

              return (
                <div
                  key={`${p.name}-${idx}`}
                  style={{
                    padding: "0.75rem 0.85rem",
                    borderRadius: "12px",
                    background: "color-mix(in srgb, var(--app-bg) 65%, transparent)",
                    border: "1px solid var(--app-border, rgba(255, 255, 255, 0.08))",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.75rem",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                      <strong
                        style={{
                          color: "var(--app-text, #ffffff)",
                          fontSize: "0.88rem",
                          fontWeight: 750,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: "100%",
                        }}
                      >
                        {p.name}
                      </strong>
                      {p.sku ? (
                        <span
                          style={{
                            fontSize: "0.65rem",
                            padding: "0.15rem 0.4rem",
                            borderRadius: "4px",
                            background: "color-mix(in srgb, var(--app-text) 8%, transparent)",
                            color: "var(--app-text-secondary, #a1a1aa)",
                            fontFamily: "monospace",
                          }}
                        >
                          {p.sku}
                        </span>
                      ) : null}
                      {isBulk ? (
                        <span
                          style={{
                            fontSize: "0.65rem",
                            padding: "0.15rem 0.4rem",
                            borderRadius: "4px",
                            background: "color-mix(in srgb, var(--trans-chap-sale) 15%, transparent)",
                            color: "var(--trans-chap-sale)",
                            fontWeight: 700,
                          }}
                        >
                          Bulk ({p.unit_factor || Math.round(totalPcs / p.qty)} pcs/{p.sell_unit || "pack"})
                        </span>
                      ) : null}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        marginTop: "0.3rem",
                        fontSize: "0.72rem",
                        color: "var(--app-text-secondary, #a1a1aa)",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontWeight: 650, color: "var(--app-text, #ffffff)" }}>
                        Qty: <strong>{p.qty}</strong>
                        {isBulk ? (
                          <span style={{ opacity: 0.85, fontWeight: 500 }}>
                            {" "}
                            {p.sell_unit || "packs"} ({totalPcs} pcs)
                          </span>
                        ) : null}
                      </span>
                      <span>·</span>
                      <span>
                        Sell: <strong>{formatKsh(p.selling_price)}</strong>
                        {isBulk && p.sell_unit ? `/${p.sell_unit}` : ""}
                      </span>
                      <span>·</span>
                      <span>
                        Cost:{" "}
                        <strong style={{ color: hasBuyingPrice ? "inherit" : "var(--app-text-muted, #71717a)" }}>
                          {hasBuyingPrice
                            ? isBulk
                              ? `${formatKsh(p.unit_buying_price ?? (p.buying_price * (p.unit_factor || 1)))}${p.sell_unit ? `/${p.sell_unit}` : "/pack"} (${formatKsh(p.buying_price)}/pc)`
                              : `${formatKsh(p.buying_price)}/pc`
                            : "Ksh 0"}
                        </strong>
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: "0.68rem",
                        color: "var(--app-text-muted, #71717a)",
                        marginTop: "0.2rem",
                      }}
                    >
                      Sales {formatKsh(p.selling_amount)} −{" "}
                      {isBulk
                        ? `Bulk cost ${formatKsh(p.buying_amount)} (${p.qty} × ${formatKsh(p.unit_buying_price ?? (p.buying_price * (p.unit_factor || 1)))})`
                        : `Cost ${formatKsh(p.buying_amount)}`}
                    </div>
                  </div>

                  {/* Markup Pill */}
                  <div
                    style={{
                      textAlign: "right",
                      flexShrink: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: "0.15rem",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 750,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--trans-chap-markup, #10b981)",
                      }}
                    >
                      Mark up
                    </div>
                    <strong
                      style={{
                        fontSize: "0.98rem",
                        fontWeight: 800,
                        color: p.markup < 0 ? "#ef4444" : "var(--trans-chap-markup, #10b981)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {p.markup >= 0 ? "+" : ""}
                      {formatKsh(p.markup)}
                    </strong>
                    {hasBuyingPrice && p.markup_percent !== undefined ? (
                      <span
                        style={{
                          fontSize: "0.68rem",
                          fontWeight: 700,
                          color: "var(--trans-chap-markup, #10b981)",
                          background: "color-mix(in srgb, var(--trans-chap-markup, #10b981) 12%, transparent)",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "4px",
                        }}
                      >
                        +{p.markup_percent}%
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <footer
          style={{
            padding: "0.85rem 1.25rem",
            borderTop: "1px solid var(--app-border, rgba(255, 255, 255, 0.08))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "0.76rem", color: "var(--app-text-secondary, #a1a1aa)" }}>
            Total earned: <strong style={{ color: "var(--trans-chap-markup, #10b981)" }}>{formatKsh(totalMarkup)}</strong>
          </span>
          <button
            type="button"
            className="trans-chap-pill-btn"
            onClick={onClose}
            style={{ padding: "0.45rem 1rem", fontSize: "0.82rem" }}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
