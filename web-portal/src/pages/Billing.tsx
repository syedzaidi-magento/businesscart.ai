import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toaster, toast } from 'react-hot-toast';
import Navbar from '../components/Navbar';
import { useAuth } from '../hooks/useAuth';
import {
  getAccounts,
  getStatement,
  getStatements,
  deleteStatement,
  setStatementPaid,
  sendStatement,
  Statement,
  PersistedStatement,
  SendStatementResponse,
} from '../api';
import { Account } from '../types';
import { PageHeader, Band, CARD, TH, TD, ROW_HOVER, Pill, Spinner } from '../components/ui';

interface Row {
  account: Account;
  statement: Statement | null;
  error: string | null;
  history: PersistedStatement[];
}

// ─────────────────────── Money ───────────────────────

// Statement money arrives as an unrounded float64: statement.Compute does
// `perOrderRate * NetTotal()` with no rounding, so a real snapshot in prod holds
// totalDue 0.054. Every figure on this page is rounded to cents ONCE, here, and
// every total sums the already-rounded values. Without that a column of rows
// each showing $0.05 can sit under a total reading $0.11. Rounding the true
// stored value is a backend decision (it changes what is billed) and belongs
// with roadmap #51 phase 2; this only stops the UI contradicting itself.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(n: number): string {
  return `$${round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─────────────────────── Period helpers ───────────────────────

interface Period {
  from: string;
  to: string;
  label: string;
  key: string; // "YYYY-MM", the <select> value
}

// A billing month is the UTC calendar month. One definition, every browser.
//
// This was built from LOCAL midnight, which is roadmap #51 finding 5 and is
// visible in the prod data: uSetGo's May statement is stored as
// 2026-05-01T07:00:00Z, seven hours late, because a Pacific browser sent the
// window. Two admins in different timezones billing "May" produced two
// different periods, and an order in the first hours of a UTC month landed in
// the neighbouring bill. UTC removes the browser from the definition entirely.
// tier.ts computes the dashboard month the same way so the estimate a seller
// reads covers the period they are invoiced for.
//
// Snapshots written before this keep their old offsets. They still match their
// month because statementsForPeriod keys on periodLabel first, which is exactly
// the case that matcher was hardened for.
function monthRange(year: number, month: number): Period {
  const first = new Date(Date.UTC(year, month, 1));
  const next = new Date(Date.UTC(year, month + 1, 1));
  return {
    from: first.toISOString(),
    to: next.toISOString(),
    label: `${first.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${first.getUTCFullYear()}`,
    key: `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}`,
  };
}

function currentMonthRange(now: Date = new Date()): Period {
  return monthRange(now.getUTCFullYear(), now.getUTCMonth());
}

// Newest first, current month at index 0. Twelve covers every period the
// platform has had orders in and stays well inside the backend's 366-day cap
// on a statement period. Negative month indexes roll the year back correctly.
function recentMonths(count: number, now: Date = new Date()): Period[] {
  const out: Period[] = [];
  for (let i = 0; i < count; i++) out.push(monthRange(now.getUTCFullYear(), now.getUTCMonth() - i));
  return out;
}

// The shared axios interceptor rejects with the raw error, whose .message is
// only "Request failed with status code 409". The server's explanation lives in
// the body as { message }, and for a refused duplicate that body IS the useful
// part. Kept local rather than changed in the interceptor, which every page
// depends on.
function apiError(err: unknown, fallback: string): string {
  const body = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (body) return body;
  return err instanceof Error ? err.message : fallback;
}

// Snapshots belonging to the selected month, newest send first.
//
// periodLabel is matched first because it is exact and timezone proof. Matching
// on the periodStart timestamp alone is not: a snapshot sent from a browser in
// another timezone stores a start shifted by that offset, and a shift of a few
// hours drops it into the NEIGHBOURING month's window. A May statement sent
// from UTC+5 stores 2026-04-30T19:00Z, which a Pacific browser would file under
// April. The timestamp window stays as the fallback for any snapshot written
// before periodLabel existed.
function statementsForPeriod(history: PersistedStatement[], period: Period): PersistedStatement[] {
  const from = new Date(period.from).getTime();
  const to = new Date(period.to).getTime();
  return history.filter((s) => {
    if (s.periodLabel) return s.periodLabel === period.label;
    const start = new Date(s.periodStart).getTime();
    return start >= from && start < to;
  });
}

// One prod company carries an empty company.name, so the fallback chain matters.
function companyLabel(account: Account): string {
  return account.company?.name || account.name || account.email;
}

// A selling company is exactly ONE account, the organisation root, whose _id is
// the sellerId stamped on every order and statement. An org member carries a
// parentAccountId and is a colleague, not a separate billable tenant, so
// listing one here would invite billing a member of a company we already bill.
// No such account exists in prod today; this keeps it that way.
function isBillableCompany(a: Account): boolean {
  return a.role === 'company' && !a.parentAccountId;
}

const MonthPicker: React.FC<{ value: Period; onChange: (p: Period) => void; disabled?: boolean }> = ({
  value,
  onChange,
  disabled,
}) => {
  const months = useMemo(() => recentMonths(12), []);
  return (
    <label className="flex items-center gap-2">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-gray-400">Period</span>
      <select
        value={value.key}
        disabled={disabled}
        onChange={(e) => {
          const next = months.find((m) => m.key === e.target.value);
          if (next) onChange(next);
        }}
        className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white disabled:opacity-50"
      >
        {months.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
};

// A statement's status is only ever what the platform can actually prove. It
// knows the bill was sent, because it holds the snapshot and the SES send, and
// it knows the bill was settled only when an admin says so via
// PUT /checkout/statements/{id}, which writes paidAt and paymentReference.
// "Open" was rejected as the unpaid label because it asserts a settlement state
// the platform does not observe on its own; "Sent" is the fact, and Paid is a
// deliberate human record, never inferred.
const StatementStatus: React.FC<{ statement: PersistedStatement }> = ({ statement }) =>
  statement.paidAt ? (
    <div className="flex flex-col items-start gap-0.5">
      <Pill tone="green">Paid</Pill>
      <span className="text-[11px] text-gray-500 tabular-nums">
        {new Date(statement.paidAt).toLocaleDateString()}
        {statement.paymentReference ? ` · ${statement.paymentReference}` : ''}
      </span>
    </div>
  ) : (
    <Pill tone="blue">Sent</Pill>
  );

const Billing: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, decodeJWT } = useAuth();
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const decoded = token ? decodeJWT(token) : null;
  const role: string = decoded?.role || '';

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (role !== 'admin' && role !== 'company') {
      toast.error('Billing not available for this role');
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate, role]);

  if (role === 'admin') return <AdminView />;
  if (role === 'company') return <CompanyView accountId={decoded?.id || ''} />;
  return null;
};

// ─────────────────────── Admin view ───────────────────────

interface PeriodCell {
  statement: Statement | null;
  error: string | null;
}

const AdminView: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [periodData, setPeriodData] = useState<Record<string, PeriodCell>>({});
  const [historyData, setHistoryData] = useState<Record<string, PersistedStatement[]>>({});
  const [loadingPeriod, setLoadingPeriod] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [selected, setSelected] = useState<Row | null>(null);
  const [retracting, setRetracting] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<string>('all');
  const historyRef = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState<Period>(() => currentMonthRange());
  const currentKey = useMemo(() => currentMonthRange().key, []);
  const isCurrent = period.key === currentKey;

  // Rapid period changes overlap. Without a token the slower response can land
  // last and paint a month the picker is no longer showing.
  const periodReq = useRef(0);
  const historyReq = useRef(0);

  useEffect(() => {
    let alive = true;
    getAccounts()
      .then((all) => {
        if (alive) setAccounts(all.filter(isBillableCompany));
      })
      .catch((err) => {
        if (alive) {
          setAccounts([]);
          toast.error(apiError(err, 'Failed to load companies'));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // Period-scoped recompute. Refires on every month change.
  useEffect(() => {
    if (!accounts) return;
    const token = ++periodReq.current;
    setLoadingPeriod(true);
    Promise.all(
      accounts.map(async (a): Promise<[string, PeriodCell]> => {
        try {
          return [a._id, { statement: await getStatement(a._id, period.from, period.to), error: null }];
        } catch (err) {
          return [a._id, { statement: null, error: err instanceof Error ? err.message : 'Failed' }];
        }
      })
    ).then((entries) => {
      if (token !== periodReq.current) return;
      setPeriodData(Object.fromEntries(entries));
      setLoadingPeriod(false);
    });
  }, [accounts, period.from, period.to]);

  // Statement history is period-independent, so it is loaded once and refreshed
  // only after a send or a retract. Reloading it on every month change was six
  // wasted requests and blanked the table behind a spinner for no reason.
  const loadHistory = useCallback(
    async (showSpinner = true) => {
      if (!accounts) return;
      const token = ++historyReq.current;
      if (showSpinner) setLoadingHistory(true);
      const entries = await Promise.all(
        accounts.map(async (a): Promise<[string, PersistedStatement[]]> => {
          try {
            return [a._id, await getStatements(a._id)];
          } catch {
            return [a._id, []];
          }
        })
      );
      if (token !== historyReq.current) return;
      setHistoryData(Object.fromEntries(entries));
      setLoadingHistory(false);
    },
    [accounts]
  );

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Alphabetical so a growing company list stays scannable; getAccounts returns
  // insertion order.
  const rows: Row[] = useMemo(
    () =>
      (accounts ?? [])
        .map((account) => ({
          account,
          statement: periodData[account._id]?.statement ?? null,
          error: periodData[account._id]?.error ?? null,
          history: historyData[account._id] ?? [],
        }))
        .sort((a, b) => companyLabel(a.account).localeCompare(companyLabel(b.account))),
    [accounts, periodData, historyData]
  );

  // Totals sum already-rounded row values so the hero always equals the column.
  const projected = round2(rows.reduce((sum, r) => sum + round2(r.statement?.totalDue || 0), 0));
  const failedCount = rows.filter((r) => r.error).length;
  const withOrders = rows.filter((r) => (r.statement?.orderCount || 0) > 0).length;
  const billedRows = rows.filter((r) => statementsForPeriod(r.history, period).length > 0);
  const periodSent = billedRows.flatMap((r) => statementsForPeriod(r.history, period));
  const periodBilled = round2(periodSent.reduce((sum, s) => sum + round2(s.totalDue), 0));
  // The live recompute for ONLY the companies that were billed, so the drift
  // check compares the same population on both sides.
  const billedRecompute = round2(
    billedRows.reduce((sum, r) => sum + round2(r.statement?.totalDue || 0), 0)
  );
  // Two statements for one company in one period is a double-send, not drift.
  const hasDuplicateSend = billedRows.some((r) => statementsForPeriod(r.history, period).length > 1);
  const driftsFromBilled = !hasDuplicateSend && periodBilled !== billedRecompute;

  const allStatements = useMemo(
    () =>
      rows
        .flatMap((r) => r.history.map((statement) => ({ statement, account: r.account })))
        // Period order, not send order. A back-billed month sent today would
        // otherwise jump above months that came after it, and duplicates for one
        // period sit adjacent this way instead of scattered down the table.
        .sort((a, b) => {
          const p = new Date(b.statement.periodStart).getTime() - new Date(a.statement.periodStart).getTime();
          return p !== 0 ? p : new Date(b.statement.sentAt).getTime() - new Date(a.statement.sentAt).getTime();
        }),
    [rows]
  );

  // Narrowing to one company is a pure client-side filter: every company's array
  // is already in memory, so a drill-down costs no request and no endpoint.
  // activeFilter is derived rather than stored so a company disappearing under a
  // refresh cannot strand the select on a dead value.
  const filterRow = historyFilter === 'all' ? null : rows.find((r) => r.account._id === historyFilter) || null;
  const activeFilter = filterRow ? historyFilter : 'all';
  const filterName = filterRow ? companyLabel(filterRow.account) : '';
  const filteredStatements = useMemo(
    () => (activeFilter === 'all' ? allStatements : allStatements.filter((e) => e.account._id === activeFilter)),
    [allStatements, activeFilter]
  );
  const totalBilled = round2(filteredStatements.reduce((sum, e) => sum + round2(e.statement.totalDue), 0));
  // ListBySeller caps at 24 per seller, so a longer history is silently truncated
  // and any lifetime total under it understates.
  const capped = rows.some((r) => r.history.length >= 24);

  const showHistoryFor = (accountId: string) => {
    setHistoryFilter(accountId);
    historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSetPaid = async (statement: PersistedStatement, name: string) => {
    const label = statement.periodLabel || new Date(statement.periodStart).toLocaleDateString();
    let reference = '';
    if (statement.paidAt) {
      if (!window.confirm(`Clear the paid mark on ${name}'s ${label} statement?`)) return;
    } else {
      const answer = window.prompt(
        `Mark ${name}'s ${label} statement (${money(statement.totalDue)}) as paid.\n\n` +
          'Payment reference, optional (cheque number, ACH id, transfer note):',
        ''
      );
      if (answer === null) return; // prompt cancelled, distinct from an empty reference
      reference = answer.trim().slice(0, 200);
    }
    setPaying(statement.id);
    try {
      await setStatementPaid(statement.id, !statement.paidAt, reference);
      toast.success(statement.paidAt ? 'Paid mark cleared' : 'Marked paid');
      await loadHistory(false);
    } catch (err) {
      toast.error(apiError(err, 'Update failed'));
    } finally {
      setPaying(null);
    }
  };

  const handleRetract = async (statement: PersistedStatement, name: string) => {
    const message =
      'Retract this statement permanently?\n\n' +
      `Company: ${name}\n` +
      `Period: ${statement.periodLabel || new Date(statement.periodStart).toLocaleDateString()}\n` +
      `Sent: ${new Date(statement.sentAt).toLocaleString()} to ${statement.recipientEmail}\n` +
      `Total billed: ${money(statement.totalDue)}\n\n` +
      'This deletes the billing record. The email that already went out cannot be recalled.';
    if (!window.confirm(message)) return;
    setRetracting(statement.id);
    try {
      await deleteStatement(statement.id);
      toast.success('Statement retracted');
      await loadHistory(false);
    } catch (err) {
      toast.error(apiError(err, 'Retract failed'));
    } finally {
      setRetracting(null);
    }
  };

  const historyCols = activeFilter === 'all' ? 9 : 8;

  return (
    <div className="flex h-screen bg-gray-100">
      <Toaster position="top-right" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            <PageHeader
              title="Billing"
              subtitle={
                <>
                  Period <strong className="text-gray-600">{period.label}</strong> · auto-derived from each
                  company&rsquo;s order count in this period.
                </>
              }
            >
              <MonthPicker value={period} onChange={setPeriod} disabled={loadingPeriod} />
            </PageHeader>

            {/* Hero: projected platform total */}
            <section className={`relative overflow-hidden ${CARD} shadow-md p-5 sm:p-6 mt-6`}>
              <span
                className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-teal-600 to-emerald-500"
                aria-hidden="true"
              />
              <div className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-gray-400">
                {isCurrent ? 'Projected' : 'Recomputed'} for {period.label} · all companies
              </div>
              <div className="text-4xl font-extrabold tracking-tight text-teal-700 tabular-nums mt-1.5">
                {money(projected)}
              </div>
              <div className="text-xs text-gray-500 mt-1.5 tabular-nums">
                {withOrders} of {rows.length} compan{rows.length === 1 ? 'y' : 'ies'} placed orders in this period
              </div>
              {failedCount > 0 && (
                <div className="text-xs text-amber-700 font-semibold mt-1 tabular-nums">
                  {failedCount} compan{failedCount === 1 ? 'y' : 'ies'} could not be loaded and{' '}
                  {failedCount === 1 ? 'is' : 'are'} excluded from this figure.
                </div>
              )}
              {periodSent.length > 0 && (
                <div className="text-xs mt-1 tabular-nums">
                  <span className="text-gray-500">
                    Billed {money(periodBilled)} across {periodSent.length} sent statement
                    {periodSent.length === 1 ? '' : 's'} for this period.
                  </span>
                  {driftsFromBilled && (
                    <span className="text-amber-700 font-semibold">
                      {' '}
                      Those companies now recompute to {money(billedRecompute)}, so orders have changed since the
                      statements went out, usually a refund.
                    </span>
                  )}
                </div>
              )}
            </section>

            <Band>Companies</Band>
            <div className={`${CARD} overflow-hidden`}>
              {loadingPeriod ? (
                <div className="p-8 flex justify-center">
                  <Spinner />
                </div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No companies found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={`${TH} text-left`}>Company</th>
                        <th className={`${TH} text-center`}>Orders</th>
                        <th className={`${TH} text-left`}>Tier</th>
                        <th className={`${TH} text-right`}>Txn fees</th>
                        <th className={`${TH} text-right`}>Total due</th>
                        <th className={`${TH} text-left`}>This period</th>
                        <th className={`${TH} text-right`}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const name = companyLabel(r.account);
                        const s = r.statement;
                        const already = statementsForPeriod(r.history, period);
                        const latest = already[0];
                        const live = round2(s?.totalDue || 0);
                        const mismatch = !!latest && round2(latest.totalDue) !== live;
                        return (
                          <tr key={r.account._id} className={ROW_HOVER}>
                            <td className={`${TD} font-semibold text-gray-800`}>
                              <button
                                type="button"
                                onClick={() => showHistoryFor(r.account._id)}
                                className="text-left underline decoration-dotted decoration-gray-300 underline-offset-4 hover:text-teal-700 hover:decoration-teal-600"
                                title={`Show ${name}'s statement history`}
                              >
                                {name}
                              </button>
                            </td>
                            {r.error ? (
                              <td colSpan={6} className={`${TD} text-center text-red-500`}>
                                {r.error}
                              </td>
                            ) : s ? (
                              <>
                                <td className={`${TD} text-center text-gray-700 tabular-nums`}>{s.orderCount}</td>
                                <td className={TD}>
                                  <Pill tone="teal">{s.tier}</Pill>
                                </td>
                                <td className={`${TD} text-right text-gray-700 tabular-nums`}>
                                  {money(s.transactionFees)}
                                </td>
                                <td className={`${TD} text-right font-bold text-gray-900 tabular-nums`}>
                                  {money(s.totalDue)}
                                </td>
                                <td className={TD}>
                                  {already.length === 0 ? (
                                    <span className="text-xs text-gray-400">Not sent</span>
                                  ) : (
                                    <div className="flex flex-col items-start gap-1">
                                      <Pill tone={already.length > 1 || mismatch ? 'amber' : 'blue'}>
                                        {already.length > 1 ? `Sent ${already.length}x` : 'Sent'}
                                      </Pill>
                                      <span className="text-xs text-gray-500 tabular-nums">
                                        billed {money(latest.totalDue)}
                                        {mismatch && (
                                          <span
                                            className="text-amber-700 font-semibold"
                                            title="The invoiced amount and a recompute from today's orders disagree, usually a refund after the statement went out."
                                          >
                                            {' '}
                                            · now {money(live)}
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  )}
                                </td>
                                <td className={`${TD} text-right`}>
                                  <button
                                    onClick={() => setSelected(r)}
                                    className={
                                      already.length > 0
                                        ? 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-white text-amber-800 border border-amber-300 hover:bg-amber-50'
                                        : 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-800'
                                    }
                                  >
                                    {already.length > 0 ? 'Send again' : 'Generate statement'}
                                  </button>
                                </td>
                              </>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div ref={historyRef}>
              <Band>Statement history</Band>
              <div className={`${CARD} overflow-hidden`}>
                {/* Filter lives inside the card so it reads as scoped to this
                    table, not to the page. The period picker above does NOT
                    filter this list, which the heading states outright. */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50/60">
                  <label className="flex items-center gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-gray-400">
                      Company
                    </span>
                    <select
                      value={activeFilter}
                      onChange={(e) => setHistoryFilter(e.target.value)}
                      disabled={loadingHistory}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white disabled:opacity-50"
                    >
                      <option value="all">All companies ({allStatements.length})</option>
                      {rows.map((r) => (
                        <option key={r.account._id} value={r.account._id}>
                          {companyLabel(r.account)} ({r.history.length})
                        </option>
                      ))}
                    </select>
                    {filterRow && (
                      <button
                        type="button"
                        onClick={() => setHistoryFilter('all')}
                        className="text-xs font-semibold text-gray-500 hover:text-teal-700 underline underline-offset-2"
                      >
                        Show all
                      </button>
                    )}
                  </label>
                  <div className="text-xs text-gray-500 tabular-nums">
                    {filterRow ? filterName : 'All companies'} · all periods ·{' '}
                    {filteredStatements.length} statement{filteredStatements.length === 1 ? '' : 's'}
                    {filteredStatements.length > 0 && <> · {money(totalBilled)} total billed</>}
                  </div>
                </div>

                {loadingHistory ? (
                  <div className="p-8 flex justify-center">
                    <Spinner />
                  </div>
                ) : filteredStatements.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">
                    {filterRow
                      ? `No statements have been sent to ${filterName} yet.`
                      : 'No statements have been sent yet. Generating one above records it here.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          {activeFilter === 'all' && <th className={`${TH} text-left`}>Company</th>}
                          <th className={`${TH} text-left`}>Period</th>
                          <th className={`${TH} text-left hidden sm:table-cell`}>Sent</th>
                          <th className={`${TH} text-center`}>Orders</th>
                          <th className={`${TH} text-left`}>Tier</th>
                          <th className={`${TH} text-right hidden md:table-cell`}>Txn fees</th>
                          <th className={`${TH} text-right`}>Total billed</th>
                          <th className={`${TH} text-left`}>Status</th>
                          <th className={`${TH} text-right`}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStatements.map(({ statement: s, account }) => {
                          // The snapshot carries the name the company was billed
                          // under, which is the historically correct one even if
                          // the account has been renamed since.
                          const name = s.companyName || companyLabel(account);
                          return (
                            <tr key={s.id} className={ROW_HOVER}>
                              {activeFilter === 'all' && (
                                <td className={`${TD} font-semibold text-gray-800`}>{name}</td>
                              )}
                              <td className={`${TD} text-gray-700`}>
                                {s.periodLabel || new Date(s.periodStart).toLocaleDateString()}
                              </td>
                              <td className={`${TD} text-gray-600 hidden sm:table-cell tabular-nums`}>
                                {new Date(s.sentAt).toLocaleDateString()}
                              </td>
                              <td className={`${TD} text-center text-gray-700 tabular-nums`}>{s.orderCount}</td>
                              <td className={TD}>
                                <Pill tone="teal">{s.tier}</Pill>
                              </td>
                              <td className={`${TD} text-right text-gray-700 hidden md:table-cell tabular-nums`}>
                                {money(s.transactionFees)}
                              </td>
                              <td className={`${TD} text-right font-bold text-gray-900 tabular-nums`}>
                                {money(s.totalDue)}
                              </td>
                              <td className={TD}>
                                <StatementStatus statement={s} />
                              </td>
                              <td className={`${TD} text-right`}>
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => handleSetPaid(s, name)}
                                    disabled={paying === s.id}
                                    className={
                                      s.paidAt
                                        ? 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-white text-gray-600 border border-gray-300 hover:bg-gray-50 disabled:opacity-50'
                                        : 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-white text-green-700 border border-green-300 hover:bg-green-50 disabled:opacity-50'
                                    }
                                  >
                                    {paying === s.id ? 'Saving…' : s.paidAt ? 'Mark unpaid' : 'Mark paid'}
                                  </button>
                                  <button
                                    onClick={() => handleRetract(s, name)}
                                    disabled={retracting === s.id}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    {retracting === s.id ? 'Retracting…' : 'Retract'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {capped && (
                          <tr>
                            <td colSpan={historyCols} className={`${TD} text-center text-xs text-amber-700`}>
                              A company has reached the 24-statement history limit. Older statements are not listed and
                              are not counted in the total above.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {selected && selected.statement && (
        <SendStatementModal
          row={selected}
          period={period}
          onClose={() => setSelected(null)}
          onSent={() => {
            toast.success('Statement sent');
            setSelected(null);
            // Orders did not change, only the snapshot list did.
            loadHistory(false);
          }}
        />
      )}
    </div>
  );
};

// ─────────────────────── Company view ───────────────────────

const CompanyView: React.FC<{ accountId: string }> = ({ accountId }) => {
  const [period, setPeriod] = useState<Period>(() => currentMonthRange());
  const currentKey = useMemo(() => currentMonthRange().key, []);
  const isCurrent = period.key === currentKey;
  const [current, setCurrent] = useState<Statement | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [history, setHistory] = useState<PersistedStatement[]>([]);
  const [loadingPeriod, setLoadingPeriod] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const periodReq = useRef(0);

  // Period-scoped, refires per month. Settled independently of history: a
  // history failure must not blank the projection, and the previous Promise.all
  // meant one 403 lost both. An org member (staff) is refused billing by the
  // backend, and that message now renders instead of a misleading $0.00 card.
  useEffect(() => {
    if (!accountId) return;
    const token = ++periodReq.current;
    setLoadingPeriod(true);
    getStatement(accountId, period.from, period.to)
      .then((cur) => {
        if (token !== periodReq.current) return;
        setCurrent(cur);
        setCurrentError(null);
      })
      .catch((err) => {
        if (token !== periodReq.current) return;
        setCurrent(null);
        setCurrentError(apiError(err, 'Failed to load billing'));
      })
      .finally(() => {
        if (token === periodReq.current) setLoadingPeriod(false);
      });
  }, [accountId, period.from, period.to]);

  // Period-independent, so it loads once rather than on every month change.
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    getStatements(accountId)
      .then((hist) => {
        if (alive) setHistory(hist);
      })
      .catch(() => {
        if (alive) setHistory([]);
      })
      .finally(() => {
        if (alive) setLoadingHistory(false);
      });
    return () => {
      alive = false;
    };
  }, [accountId]);

  // For a closed month the live recompute is an estimate, not the bill. What the
  // company was actually charged is the snapshot, which cannot drift.
  const billed = statementsForPeriod(history, period);
  const latestBilled = billed[0];
  const mismatch = !!latestBilled && !!current && round2(latestBilled.totalDue) !== round2(current.totalDue);
  const capped = history.length >= 24;

  return (
    <div className="flex h-screen bg-gray-100">
      <Toaster position="top-right" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            <PageHeader
              title="Billing"
              subtitle="Your tier auto-applies based on monthly order volume. Statements are emailed by the BusinessCart team."
            >
              <MonthPicker value={period} onChange={setPeriod} disabled={loadingPeriod} />
            </PageHeader>

            {/* Hero: selected period */}
            <section className={`relative overflow-hidden ${CARD} shadow-md p-5 sm:p-6 mt-6`}>
              <span
                className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-teal-600 to-emerald-500"
                aria-hidden="true"
              />
              {loadingPeriod ? (
                <div className="py-6 flex justify-center">
                  <Spinner />
                </div>
              ) : currentError ? (
                <>
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-gray-400">
                    {period.label}
                  </div>
                  <p className="text-sm text-gray-700 mt-2">{currentError}</p>
                </>
              ) : (
                <>
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-gray-400">
                    {isCurrent ? `Projected for ${period.label} · in progress` : `Recomputed for ${period.label}`}
                  </div>
                  <div className="text-4xl font-extrabold tracking-tight text-teal-700 tabular-nums mt-1.5">
                    {money(current?.totalDue || 0)}
                  </div>
                  {current && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2.5 text-[13px] text-gray-600 tabular-nums">
                      <Pill tone="teal">{current.tier}</Pill>
                      <span>
                        {current.orderCount} order{current.orderCount === 1 ? '' : 's'}
                        {isCurrent ? ' so far' : ''}
                      </span>
                      <span className="text-gray-300">·</span>
                      <span>
                        {money(current.transactionFees)} in per-order fees
                      </span>
                    </div>
                  )}
                  {latestBilled && (
                    <div className="mt-3 text-[13px] tabular-nums">
                      <span className="text-gray-500">
                        Billed {money(latestBilled.totalDue)} on {new Date(latestBilled.sentAt).toLocaleDateString()}
                        {billed.length > 1 ? ` (${billed.length} statements sent for this period)` : ''}. The sent
                        statement below is the figure that stands.
                      </span>
                      {mismatch && (
                        <span className="text-amber-700 font-semibold">
                          {' '}
                          The estimate above differs because it recomputes from your orders as they stand today.
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>

            <Band>Sent statements</Band>
            <div className={`${CARD} overflow-hidden`}>
              {loadingHistory ? (
                <div className="p-8 flex justify-center">
                  <Spinner />
                </div>
              ) : history.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">
                  No statements sent yet. The first one appears here once your billing period closes.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={`${TH} text-left`}>Period</th>
                        <th className={`${TH} text-left hidden sm:table-cell`}>Sent</th>
                        <th className={`${TH} text-center`}>Orders</th>
                        <th className={`${TH} text-left`}>Tier</th>
                        <th className={`${TH} text-right hidden md:table-cell`}>Txn fees</th>
                        <th className={`${TH} text-right`}>Total billed</th>
                        <th className={`${TH} text-left`}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((s) => (
                        <tr key={s.id} className={ROW_HOVER}>
                          <td className={`${TD} font-semibold text-gray-800`}>
                            {s.periodLabel || new Date(s.periodStart).toLocaleDateString()}
                          </td>
                          <td className={`${TD} text-gray-600 hidden sm:table-cell tabular-nums`}>
                            {new Date(s.sentAt).toLocaleDateString()}
                          </td>
                          <td className={`${TD} text-center text-gray-700 tabular-nums`}>{s.orderCount}</td>
                          <td className={TD}>
                            <Pill tone="teal">{s.tier}</Pill>
                          </td>
                          <td className={`${TD} text-right text-gray-700 hidden md:table-cell tabular-nums`}>
                            {money(s.transactionFees)}
                          </td>
                          <td className={`${TD} text-right font-bold text-gray-900 tabular-nums`}>
                            {money(s.totalDue)}
                          </td>
                          <td className={TD}>
                            <StatementStatus statement={s} />
                          </td>
                        </tr>
                      ))}
                      {capped && (
                        <tr>
                          <td colSpan={7} className={`${TD} text-center text-xs text-amber-700`}>
                            Only your 24 most recent statements are listed.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

// ─────────────────────── Send modal (admin only) ───────────────────────

interface ModalProps {
  row: Row;
  period: Period;
  onClose: () => void;
  onSent: () => void;
}

const SendStatementModal: React.FC<ModalProps> = ({ row, period, onClose, onSent }) => {
  const account = row.account;
  const stmt = row.statement!;
  const defaultRecipient = account.email || '';
  const [recipientEmail, setRecipientEmail] = useState(defaultRecipient);
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [preview, setPreview] = useState<SendStatementResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const already = statementsForPeriod(row.history, period);

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const res = await sendStatement({
        sellerId: account._id,
        from: period.from,
        to: period.to,
        recipientEmail,
        companyName: companyLabel(account),
        periodLabel: period.label,
        paymentInstructions,
        dryRun: true,
      });
      setPreview(res);
    } catch (err) {
      toast.error(apiError(err, 'Preview failed'));
    } finally {
      setPreviewing(false);
    }
  };

  const handleSend = async () => {
    if (!preview) {
      toast.error('Click Preview first');
      return;
    }
    // A zero-total period is a legitimate bill and sends without objection.
    // The only thing worth stopping on is billing the same period twice, which
    // the backend will happily do: Save is a plain insert with no unique index.
    const duplicateWarning =
      already.length > 0
        ? `\n\nWARNING: ${already.length} statement${already.length === 1 ? ' has' : 's have'} already been sent for ` +
          `${period.label}, the most recent on ${new Date(already[0].sentAt).toLocaleDateString()} for ` +
          `${money(already[0].totalDue)}. Sending now bills this company again.`
        : '';
    if (!window.confirm(`Send statement to ${recipientEmail} for ${money(stmt.totalDue)}?${duplicateWarning}`)) return;
    setSending(true);
    try {
      await sendStatement({
        sellerId: account._id,
        from: period.from,
        to: period.to,
        recipientEmail,
        companyName: companyLabel(account),
        periodLabel: period.label,
        paymentInstructions,
        dryRun: false,
        allowDuplicate: already.length > 0,
      });
      onSent();
    } catch (err) {
      toast.error(apiError(err, 'Send failed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">Send Statement · {period.label}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {already.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">
                Already sent for {period.label}
                {already.length > 1 ? ` (${already.length} times)` : ''}
              </p>
              <p className="mt-0.5">
                Most recent: {new Date(already[0].sentAt).toLocaleString()} to {already[0].recipientEmail} for{' '}
                {money(already[0].totalDue)}. Sending again bills this company a second time.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Recipient email
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Payment instructions (max 2000 chars)
            </label>
            <textarea
              value={paymentInstructions}
              onChange={(e) => setPaymentInstructions(e.target.value.slice(0, 2000))}
              placeholder="e.g., Pay via ACH to ... or by Stripe link below."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
            />
          </div>

          <div className="bg-gray-50 rounded-md p-3 text-sm">
            <p className="font-semibold text-gray-700 mb-1">Statement summary</p>
            <p className="text-gray-600">
              Tier: <strong>{stmt.tier}</strong>
            </p>
            <p className="text-gray-600">
              Orders: <strong>{stmt.orderCount}</strong>
            </p>
            <p className="text-gray-600">
              Gross revenue: <strong>{money(stmt.totalGrandTotal)}</strong>
            </p>
            {/* Only when refunds exist. Without these two lines the transaction fee
                does not reconcile against gross revenue and there is nothing on the
                statement explaining the difference. */}
            {(stmt.totalRefunded ?? 0) > 0 && (
              <>
                <p className="text-gray-600">
                  Refunds issued: <strong className="text-red-700">-{money(stmt.totalRefunded ?? 0)}</strong>
                </p>
                <p className="text-gray-600">
                  Net revenue: <strong>{money(stmt.totalGrandTotal - (stmt.totalRefunded ?? 0))}</strong>
                </p>
              </>
            )}
            <p className="text-gray-600">
              Transaction fees: <strong>{money(stmt.transactionFees)}</strong>
            </p>
            <p className="text-gray-900 mt-1">
              Total due: <strong className="text-teal-700">{money(stmt.totalDue)}</strong>
            </p>
          </div>

          {!preview && (
            <button
              onClick={handlePreview}
              disabled={previewing}
              className="w-full px-4 py-2 text-sm font-medium rounded bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {previewing ? 'Generating preview…' : 'Preview email'}
            </button>
          )}

          {preview && (
            <>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Email preview (HTML)
                </p>
                <div className="border border-gray-200 rounded-md overflow-hidden bg-white">
                  <div className="p-2 text-sm" dangerouslySetInnerHTML={{ __html: preview.htmlBody || '' }} />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPreview(null)}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                >
                  Edit
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {sending ? 'Sending…' : `Send to ${recipientEmail}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Billing;
