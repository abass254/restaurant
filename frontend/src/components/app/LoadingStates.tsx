"use client";

import { Skeleton } from "@/components/app/Skeleton";

export function PageHeaderSkeleton() {
  return (
    <header className="page-loading-shell__header">
      <Skeleton variant="text" height={28} width={200} />
      <Skeleton variant="text" height={14} width={360} />
    </header>
  );
}

export function TableSkeleton({
  columns = 5,
  rows = 6,
  headers,
  className,
  tableClassName = "inventory-table",
}: {
  columns?: number;
  rows?: number;
  headers?: string[];
  className?: string;
  tableClassName?: string;
}) {
  return (
    <div
      className={["inventory-table-wrap", className].filter(Boolean).join(" ")}
      aria-busy="true"
      aria-live="polite"
    >
      <table className={tableClassName}>
        {headers ? (
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columns }).map((__, columnIndex) => (
                <td key={columnIndex}>
                  <Skeleton variant="text" width="70%" height={12} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardCardSkeleton() {
  return (
    <article className="dashboard-card">
      <header className="dashboard-card__head">
        <div>
          <Skeleton variant="text" height={18} width={120} />
          <Skeleton variant="text" height={12} width={220} />
        </div>
      </header>
      <div className="page-loading-shell__card-body">
        <Skeleton variant="text" height={12} width="100%" />
        <Skeleton variant="text" height={12} width="92%" />
        <Skeleton variant="text" height={12} width="78%" />
        <Skeleton variant="text" height={12} width="64%" />
      </div>
    </article>
  );
}

export function ListSkeleton({ items = 4 }: { items?: number }) {
  return (
    <ul className="app-list" aria-busy="true" aria-live="polite">
      {Array.from({ length: items }).map((_, index) => (
        <li key={index}>
          <Skeleton variant="text" height={16} width="42%" />
          <Skeleton variant="text" height={12} width="68%" />
        </li>
      ))}
    </ul>
  );
}

export function SettingsCardSkeleton() {
  return (
    <article className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <Skeleton variant="circle" width={20} height={20} />
          <Skeleton variant="text" height={18} width={120} />
        </div>
      </header>
      <div className="settings-card__body page-loading-shell__card-body">
        <Skeleton variant="text" height={12} width="88%" />
        <Skeleton variant="text" height={12} width="72%" />
        <Skeleton variant="rect" height={40} width="100%" />
      </div>
    </article>
  );
}

export function PageLoadingShell() {
  return (
    <section
      className="app-panel page-loading-shell"
      aria-busy="true"
      aria-live="polite"
    >
      <PageHeaderSkeleton />
      <TableSkeleton columns={5} rows={6} />
    </section>
  );
}

export function AdminPageLoadingShell() {
  return (
    <section
      className="admin-page page-loading-shell"
      aria-busy="true"
      aria-live="polite"
    >
      <header className="admin-page__header">
        <div>
          <Skeleton variant="text" height={28} width={180} />
          <Skeleton variant="text" height={14} width={320} />
        </div>
      </header>
      <div className="admin-stat-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} variant="rect" height={96} />
        ))}
      </div>
      <TableSkeleton
        columns={4}
        rows={5}
        tableClassName="admin-table"
        headers={["Name", "Status", "Orders", "Updated"]}
      />
    </section>
  );
}
