"use client";

import { useEffect, useRef, useState } from "react";
import { toastSuccess } from "@/lib/alerts";
import { createTransChapExpense } from "@/lib/trans-chap-expenses";

const QUICK_ERRANDS = [
  "Boda / Transport",
  "Staff lunch & tea",
  "Packaging materials",
  "Electricity tokens",
  "Casual wages / loading",
  "Shop cleaning",
  "Airtime / Data",
  "Water delivery",
];

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export function RecordExpenseModal({ isOpen, onClose, onCreated }: Props) {
  const [amount, setAmount] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "mpesa">("cash");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setTitle("");
      setPaymentMethod("cash");
      setNotes("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(amount.trim());
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Please enter a valid amount greater than 0");
      return;
    }
    if (!title.trim()) {
      setError("Please enter an errand description or purpose");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await createTransChapExpense({
        title: title.trim(),
        amount: parsedAmount,
        category: "errand",
        payment_method: paymentMethod,
        notes: notes.trim() || undefined,
      });

      if (res.error) {
        setError(res.error);
        setSaving(false);
        return;
      }

      toastSuccess(`Recorded errand: Ksh ${parsedAmount.toLocaleString()}`);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record errand");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="trans-chap-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="record-expense-title">
      <div className="trans-chap-modal trans-chap-modal--compact">
        <header className="trans-chap-modal__header">
          <div>
            <h3 id="record-expense-title">Record Daily Errand</h3>
            <p>Log daily shop errands, petty cash, lunch, or transport</p>
          </div>
          <button
            type="button"
            className="trans-chap-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <i className="fa-solid fa-xmark" aria-hidden />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="trans-chap-modal__form">
          {error ? <div className="trans-chap-form__alert-error">{error}</div> : null}

          <div className="trans-chap-form__field">
            <label htmlFor="errand-amount">Amount (Ksh)</label>
            <div className="trans-chap-form__amount-wrap">
              <span className="trans-chap-form__currency">Ksh</span>
              <input
                id="errand-amount"
                ref={inputRef}
                type="number"
                inputMode="decimal"
                step="any"
                min="1"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="trans-chap-form__amount-input"
              />
            </div>
          </div>

          <div className="trans-chap-form__field">
            <label htmlFor="errand-title">Errand / Description</label>
            <input
              id="errand-title"
              type="text"
              placeholder="e.g. Boda boda to market, Tea & mandazi"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="trans-chap-form__input"
            />
          </div>

          <div className="trans-chap-form__quick-pills">
            <span>Quick suggestions:</span>
            <div className="trans-chap-form__pills-list">
              {QUICK_ERRANDS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="trans-chap-pill-btn"
                  onClick={() => setTitle(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="trans-chap-form__field">
            <label>Paid via</label>
            <div className="trans-chap-form__toggle-group">
              <button
                type="button"
                className={`trans-chap-form__toggle-btn ${paymentMethod === "cash" ? "is-active" : ""}`}
                onClick={() => setPaymentMethod("cash")}
              >
                <i className="fa-solid fa-money-bill-wave" aria-hidden /> Cash
              </button>
              <button
                type="button"
                className={`trans-chap-form__toggle-btn ${paymentMethod === "mpesa" ? "is-active" : ""}`}
                onClick={() => setPaymentMethod("mpesa")}
              >
                <i className="fa-solid fa-mobile-screen-button" aria-hidden /> M-PESA
              </button>
            </div>
          </div>

          <div className="trans-chap-form__field">
            <label htmlFor="errand-notes">Notes (optional)</label>
            <input
              id="errand-notes"
              type="text"
              placeholder="Additional details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="trans-chap-form__input"
            />
          </div>

          <footer className="trans-chap-modal__actions">
            <button
              type="button"
              className="trans-chap-btn trans-chap-btn--secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="trans-chap-btn trans-chap-btn--primary"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Errand"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
