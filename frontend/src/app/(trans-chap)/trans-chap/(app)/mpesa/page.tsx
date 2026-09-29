"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListLoadError } from "@/components/app/ListLoadError";
import { Skeleton } from "@/components/app/Skeleton";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import type { MpesaTransaction, MpesaTransactionsResponse } from "@/lib/types";

const PAGE_SIZE = 100;

function formatAmount(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function transactionStatus(status: MpesaTransaction["status"]): string {
  switch (status) {
    case "success":
      return "Paid";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

export default function TransChapMpesaPage() {
  const [transactions, setTransactions] = useState<MpesaTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (offset: number) => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      has_receipt_code: "true",
    });
    return apiFetch<MpesaTransactionsResponse>(
      `${apiRoutes.mpesaTransactions}?${params.toString()}`,
    );
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await loadPage(0);
      setTransactions(response.transactions);
      setTotal(response.total ?? response.transactions.length);
    } catch {
      setError("Could not load M-PESA transactions. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [loadPage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return transactions;
    return transactions.filter((transaction) =>
      [
        transaction.phone_number,
        transaction.mpesa_receipt_number,
        transaction.account_reference,
        transaction.transaction_desc,
        transaction.status,
        String(transaction.amount),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [search, transactions]);

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const response = await loadPage(transactions.length);
      setTransactions((current) => [...current, ...response.transactions]);
      setTotal(response.total ?? total);
    } catch {
      setError("Could not load more transactions. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  const hasMore = transactions.length < total;

  return (
    <section className="trans-chap-mpesa">
      <header className="trans-chap-mpesa__head">
        <div>
          <h2>M-PESA transactions</h2>
          <p>Merchant payments with an M-PESA receipt code.</p>
        </div>
        <button
          type="button"
          className="trans-chap-mpesa__refresh"
          onClick={() => void reload()}
          disabled={loading}
        >
          <i className="fa-solid fa-arrows-rotate" aria-hidden />
          Refresh
        </button>
      </header>

      <label className="trans-chap-mpesa__search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search receipt, phone, reference…"
          aria-label="Search M-PESA transactions"
        />
      </label>

      {loading ? (
        <div className="trans-chap-mpesa__loading" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div className="trans-chap-mpesa__skeleton" key={row}>
              <Skeleton variant="text" width="28%" height={16} />
              <Skeleton variant="text" width="18%" height={16} />
              <Skeleton variant="text" width="24%" height={16} />
            </div>
          ))}
        </div>
      ) : error && transactions.length === 0 ? (
        <ListLoadError
          title="Could not load M-PESA transactions"
          message={error}
          onRetry={() => void reload()}
        />
      ) : filtered.length === 0 ? (
        <div className="trans-chap-mpesa__empty">
          <i className="fa-solid fa-receipt" aria-hidden />
          <strong>
            {transactions.length ? "No matching transactions" : "No coded M-PESA payments yet"}
          </strong>
          <span>
            {transactions.length
              ? "Try searching by receipt code, phone, or reference."
              : "Transactions appear here after an M-PESA receipt code is recorded."}
          </span>
        </div>
      ) : (
        <>
          <div className="trans-chap-mpesa__summary">
            Showing {filtered.length} of {transactions.length} loaded · {total} total
          </div>
          <div className="trans-chap-mpesa__list">
            {filtered.map((transaction) => (
              <article className="trans-chap-mpesa__row" key={transaction.id}>
                <div className="trans-chap-mpesa__main">
                  <strong>{transaction.mpesa_receipt_number}</strong>
                  <span>{transaction.phone_number}</span>
                  <small>
                    {transaction.transaction_desc || transaction.account_reference}
                  </small>
                </div>
                <div className="trans-chap-mpesa__details">
                  <strong>{formatAmount(transaction.amount)}</strong>
                  <span
                    className={`trans-chap-mpesa__status is-${transaction.status}`}
                  >
                    {transactionStatus(transaction.status)}
                  </span>
                  <time dateTime={transaction.created_at ?? undefined}>
                    {formatNairobiDateTime(transaction.created_at) || "Date unavailable"}
                  </time>
                </div>
              </article>
            ))}
          </div>
          {error ? <p className="trans-chap-mpesa__error">{error}</p> : null}
          {hasMore ? (
            <button
              type="button"
              className="trans-chap-mpesa__more"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more transactions"}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
