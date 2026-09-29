"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import { StorefrontHeader } from "@/components/storefront/StorefrontHeader";
import { formatMoney } from "@/lib/orders";

type ShopItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  unit: string | null;
  price: number;
  image_url: string | null;
};

type ShopData = {
  merchant: { name: string; username: string | null };
  currency: string;
  saved_phone: string | null;
  expires_in: number;
  items: ShopItem[];
};

type ShopResponse = { data: ShopData };

type CheckoutResult = {
  order_number: string;
  total: number;
  currency: string;
  item_count: number;
  tracking_url?: string | null;
};

type CheckoutResponse = { data: CheckoutResult };

type PageStatus =
  | "loading"
  | "ready"
  | "placing"
  | "placed"
  | "expired"
  | "error";

function nameInitial(name: string | null | undefined): string {
  const ch = (name ?? "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

export default function StorefrontPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shop, setShop] = useState<ShopData | null>(null);
  // Cart is a map of inventory item id -> quantity.
  const [cart, setCart] = useState<Record<string, number>>({});
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<CheckoutResult | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("Missing storefront link.");
      return;
    }
    let alive = true;
    apiFetch<ShopResponse>(apiRoutes.shop(token))
      .then((res) => {
        if (!alive) return;
        setShop(res.data);
        if (res.data.saved_phone) setPhone(res.data.saved_phone);
        setStatus("ready");
      })
      .catch((err) => {
        if (!alive) return;
        const gone = err instanceof ApiError && err.status === 410;
        setErrorMsg(
          err instanceof ApiError
            ? err.message
            : "This storefront link is invalid or expired.",
        );
        setStatus(gone ? "expired" : "error");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const itemsById = useMemo(() => {
    const map = new Map<string, ShopItem>();
    for (const item of shop?.items ?? []) map.set(item.id, item);
    return map;
  }, [shop]);

  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ item: itemsById.get(id), qty }))
        .filter((line): line is { item: ShopItem; qty: number } =>
          Boolean(line.item),
        ),
    [cart, itemsById],
  );

  const itemCount = useMemo(
    () => cartLines.reduce((sum, l) => sum + l.qty, 0),
    [cartLines],
  );
  const total = useMemo(
    () => cartLines.reduce((sum, l) => sum + l.item.price * l.qty, 0),
    [cartLines],
  );

  const currency = shop?.currency ?? "KES";

  function addToCart(item: ShopItem) {
    setCart((prev) => ({ ...prev, [item.id]: (prev[item.id] ?? 0) + 1 }));
  }

  function changeQty(id: string, delta: number) {
    setCart((prev) => {
      const next = { ...prev };
      const value = (next[id] ?? 0) + delta;
      if (value <= 0) delete next[id];
      else next[id] = Math.min(value, 999);
      return next;
    });
  }

  function removeLine(id: string) {
    setCart((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function checkout() {
    if (cartLines.length === 0 || !token) return;
    if (!phone.trim()) {
      setErrorMsg("Enter your M-PESA phone number to place the order.");
      return;
    }
    setStatus("placing");
    setErrorMsg(null);
    try {
      const res = await apiFetch<CheckoutResponse>(apiRoutes.shopCheckout(token), {
        method: "POST",
        body: JSON.stringify({
          phone: phone.trim(),
          items: cartLines.map((l) => ({
            inventory_item_id: l.item.id,
            quantity: l.qty,
          })),
        }),
      });
      setResult(res.data);
      setCart({});
      setStatus("placed");
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr?.status === 410) {
        setStatus("expired");
        setErrorMsg(
          apiErr.message ||
            "This link has already been used. Reply 'catalogue' in your chat for a fresh one.",
        );
      } else {
        setStatus("ready");
        setErrorMsg(apiErr?.message ?? "Could not place your order. Try again.");
      }
    }
  }

  return (
    <main className="sf-shell">
      <StorefrontHeader tag="Order online" />

      {status === "loading" ? (
        <section className="sf-card sf-card--centered">
          <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
          <p>Loading the catalogue…</p>
        </section>
      ) : null}

      {status === "expired" ? (
        <section className="sf-card sf-card--centered">
          <i
            className="fa-solid fa-clock-rotate-left sf-card__icon"
            aria-hidden="true"
          />
          <h1>This link has expired</h1>
          <p>
            {errorMsg ??
              "Reply 'catalogue' in your chat and we'll send you a fresh link."}
          </p>
        </section>
      ) : null}

      {status === "error" ? (
        <section className="sf-card sf-card--centered">
          <i
            className="fa-solid fa-circle-exclamation sf-card__icon"
            aria-hidden="true"
          />
          <h1>Storefront unavailable</h1>
          <p>{errorMsg}</p>
        </section>
      ) : null}

      {status === "placed" && result ? (
        <section className="sf-card sf-card--centered sf-placed">
          <i
            className="fa-solid fa-circle-check sf-placed__icon"
            aria-hidden="true"
          />
          <h1>Order placed!</h1>
          <p className="sf-placed__ref">
            Ref <strong>{result.order_number}</strong>
          </p>
          <p className="sf-placed__total">
            {formatMoney(result.total, result.currency)} ·{" "}
            {result.item_count} item{result.item_count === 1 ? "" : "s"}
          </p>
          {result.tracking_url ? (
            <a href={result.tracking_url} className="btn btn-primary sf-placed__track">
              Track your order
            </a>
          ) : null}
          <p className="sf-hint">
            Check your chat for order updates. We will send a payment link when
            your order is ready to pay. You can close this page.
          </p>
        </section>
      ) : null}

      {(status === "ready" || status === "placing") && shop ? (
        <>
          {shop.items.length === 0 ? (
            <section className="sf-card sf-card--centered">
              <i className="fa-solid fa-box-open sf-card__icon" aria-hidden="true" />
              <p>This shop has no items listed yet.</p>
            </section>
          ) : (
            <section className="sf-catalog">
              {shop.items.map((item) => {
                const inCart = cart[item.id] ?? 0;
                const img = resolveAssetUrl(item.image_url);
                return (
                  <article key={item.id} className="sf-product">
                    <div className="sf-product__media">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" />
                      ) : (
                        <span className="sf-product__placeholder" aria-hidden="true">
                          {nameInitial(item.name)}
                        </span>
                      )}
                      {inCart > 0 ? (
                        <span className="sf-product__badge">{inCart}</span>
                      ) : null}
                    </div>
                    <div className="sf-product__body">
                      <strong className="sf-product__name">{item.name}</strong>
                      {item.brand ? (
                        <span className="sf-product__brand">{item.brand}</span>
                      ) : null}
                      <span className="sf-product__price">
                        {formatMoney(item.price, currency)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="sf-product__add"
                      onClick={() => addToCart(item)}
                      disabled={status === "placing"}
                    >
                      <i className="fa-solid fa-plus" aria-hidden="true" />
                      Add
                    </button>
                  </article>
                );
              })}
            </section>
          )}

          {errorMsg ? <p className="sf-error">{errorMsg}</p> : null}

          {cartLines.length > 0 ? (
            <section className="sf-card sf-cart">
              <header className="sf-cart__head">
                <strong>
                  <i className="fa-solid fa-basket-shopping" aria-hidden="true" />{" "}
                  Selected products
                </strong>
                <span>
                  {itemCount} item{itemCount === 1 ? "" : "s"}
                </span>
              </header>

              <ul className="sf-cart__lines">
                {cartLines.map(({ item, qty }) => (
                  <li key={item.id} className="sf-line">
                    <div className="sf-line__info">
                      <span className="sf-line__name">{item.name}</span>
                      <span className="sf-line__unit">
                        {formatMoney(item.price, currency)} each
                      </span>
                    </div>
                    <div className="sf-stepper">
                      <button
                        type="button"
                        aria-label="Decrease"
                        onClick={() => changeQty(item.id, -1)}
                        disabled={status === "placing"}
                      >
                        <i className="fa-solid fa-minus" aria-hidden="true" />
                      </button>
                      <span className="sf-stepper__value">{qty}</span>
                      <button
                        type="button"
                        aria-label="Increase"
                        onClick={() => changeQty(item.id, 1)}
                        disabled={status === "placing"}
                      >
                        <i className="fa-solid fa-plus" aria-hidden="true" />
                      </button>
                    </div>
                    <span className="sf-line__total">
                      {formatMoney(item.price * qty, currency)}
                    </span>
                    <button
                      type="button"
                      className="sf-line__remove"
                      aria-label="Remove"
                      onClick={() => removeLine(item.id)}
                      disabled={status === "placing"}
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>

              <div className="sf-total">
                <span>Total</span>
                <strong>{formatMoney(total, currency)}</strong>
              </div>

              <label className="sf-field">
                <span>M-PESA phone number</span>
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="07XX XXX XXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={status === "placing"}
                />
              </label>

              <button
                type="button"
                className="sf-checkout"
                onClick={() => void checkout()}
                disabled={
                  status === "placing" || cartLines.length === 0 || !phone.trim()
                }
              >
                {status === "placing" ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                    Placing order…
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-lock" aria-hidden="true" />
                    Place order · {formatMoney(total, currency)}
                  </>
                )}
              </button>
              <p className="sf-hint">
                You'll get an M-PESA prompt to pay after placing the order.
              </p>
            </section>
          ) : (
            <p className="sf-hint sf-hint--empty">
              Tap <strong>Add</strong> on the items you want, then check out.
            </p>
          )}
        </>
      ) : null}
    </main>
  );
}
