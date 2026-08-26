"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { RegisterInsights } from "../../lib/registers/insights";
import { registerHref, type RegisterParams } from "../../lib/registers/queue-params";

/** Charts animate by default; a reader who asked for stillness gets stillness. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

const tooltipStyle = {
  background: "var(--glass-strong)",
  border: "1px solid var(--glass-border)",
  borderRadius: "12px",
  boxShadow: "var(--shadow-card)",
  color: "var(--ink)",
};

/** Lapsed and imminent read as trouble; distant runway reads as fine. */
const RUNWAY_COLORS: Record<string, string> = {
  expired: "var(--chart-critical)",
  d30: "var(--chart-warning)",
  d60: "var(--chart-waiting)",
  d90: "var(--chart-review)",
  d180: "var(--chart-complete)",
  beyond: "var(--chart-bar)",
};

function Panel({ children, detail, eyebrow, title }: { children: React.ReactNode; detail: string; eyebrow: string; title: string }) {
  return (
    <article className="analytics-card register-insight-card surface-card">
      <header className="analytics-card-heading">
        <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
        <span>{detail}</span>
      </header>
      {children}
    </article>
  );
}

/**
 * What the registers say about the firm rather than about any one entry.
 *
 * Four questions a partner asks and the register could not previously answer:
 * how fast do we answer notices, when does our signing capability run out, who
 * is signing and how often is it withdrawn, and which tokens are still out.
 */
export function RegisterInsightsPanel({
  insights,
  params,
  todayKey,
}: {
  insights: RegisterInsights;
  params: RegisterParams;
  todayKey: string;
}) {
  const reducedMotion = useReducedMotion();
  const { authorities, custody, runway, signers, trend, turnaround } = insights;
  const noticeTotal = authorities.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <div className="register-insights">
      <Panel
        detail={turnaround.sample ? `${turnaround.sample} answered` : "No answered notices yet"}
        eyebrow="RESPONSIVENESS"
        title="Notice turnaround"
      >
        {turnaround.sample === 0 ? (
          <p className="analytics-empty">Turnaround appears once notices have been answered.</p>
        ) : (
          <>
            <div className="register-stat-row">
              <span><strong>{turnaround.medianDays}d</strong><small>Median</small></span>
              <span><strong>{turnaround.fastest}d</strong><small>Fastest</small></span>
              <span><strong>{turnaround.slowest}d</strong><small>Slowest</small></span>
            </div>
            <div aria-label="Notice turnaround distribution" className="analytics-chart analytics-chart-compact" role="img">
              <ResponsiveContainer height="100%" width="100%">
                <BarChart data={turnaround.buckets} margin={{ bottom: 0, left: -24, right: 4, top: 12 }}>
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} />
                  <YAxis allowDecimals={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-hover)" }} />
                  <Bar dataKey="count" fill="var(--chart-review)" isAnimationActive={!reducedMotion} name="Notices" radius={[6, 6, 2, 2]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Panel>

      <Panel detail="Live certificates only" eyebrow="CAPABILITY" title="Signing runway">
        <div aria-label="Certificate expiry runway" className="analytics-chart analytics-chart-compact" role="img">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={runway} margin={{ bottom: 0, left: -24, right: 4, top: 12 }}>
              <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} />
              <YAxis allowDecimals={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-hover)" }} />
              <Bar dataKey="count" isAnimationActive={!reducedMotion} name="Certificates" radius={[6, 6, 2, 2]}>
                {runway.map((window) => <Cell fill={RUNWAY_COLORS[window.key] ?? "var(--chart-bar)"} key={window.key} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ul className="analytics-text-summary">
          {runway.filter((window) => window.count > 0).map((window) => (
            <li key={window.key}>
              <Link href={registerHref({ ...params, band: window.key === "expired" ? "expired" : "all", focus: "", page: 1, status: "all", tab: "dsc" })}>
                {window.label}
              </Link>
              <strong>{window.count}</strong>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel detail={`Last six months to ${todayKey.slice(0, 7)}`} eyebrow="SIGNING" title="UDIN volume">
        <div aria-label="UDIN volume by month" className="analytics-chart analytics-chart-compact" role="img">
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart data={trend} margin={{ bottom: 0, left: -24, right: 4, top: 12 }}>
              <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} />
              <YAxis allowDecimals={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-hover)" }} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="active" fill="var(--chart-complete)" isAnimationActive={!reducedMotion} name="Active" radius={[6, 6, 2, 2]} stackId="udin" />
              <Bar dataKey="revoked" fill="var(--chart-critical)" isAnimationActive={!reducedMotion} name="Revoked" radius={[6, 6, 2, 2]} stackId="udin" />
              <Line dataKey="active" dot={false} isAnimationActive={!reducedMotion} legendType="none" stroke="var(--accent)" strokeWidth={2} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel detail={`${signers.length} signing`} eyebrow="ATTRIBUTION" title="By signatory">
        {signers.length === 0 ? <p className="analytics-empty">No UDINs have been recorded yet.</p> : (
          <ul className="register-rank-list">
            {signers.map((signer) => (
              <li key={signer.name}>
                <span><strong>{signer.name}</strong><small>{signer.active} active · {signer.revoked} revoked</small></span>
                {/* A revocation rate is the one number worth reading per signer. */}
                <em className={signer.revocationRate >= 10 ? "is-hot" : undefined}>{signer.revocationRate}%</em>
                <b>{signer.total}</b>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel detail={`${noticeTotal} notices`} eyebrow="PRESSURE" title="By authority">
        {authorities.length === 0 ? <p className="analytics-empty">No notices have been logged yet.</p> : (
          <ul className="register-rank-list">
            {authorities.map((entry) => (
              <li key={entry.authority}>
                <span>
                  <Link href={registerHref({ ...params, authority: entry.authority, focus: "", page: 1, status: "all", tab: "notices" })}>
                    <strong>{entry.label}</strong>
                  </Link>
                  <small>{entry.open} open{entry.overdue ? ` · ${entry.overdue} overdue` : ""}</small>
                </span>
                <em className={entry.overdue ? "is-hot" : undefined}>{entry.overdue || "—"}</em>
                <b>{entry.total}</b>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel detail={custody.length ? `${custody.length} out` : "All accounted for"} eyebrow="CUSTODY" title="Longest signed out">
        {custody.length === 0 ? <p className="analytics-empty">Every certificate is in the firm&rsquo;s custody.</p> : (
          <ul className="register-rank-list">
            {custody.map((entry) => (
              <li key={entry.id}>
                <span>
                  <Link href={registerHref({ ...params, focus: entry.id, status: "all", tab: "dsc" })}>
                    <strong>{entry.serialNumber}</strong>
                  </Link>
                  <small>{entry.holderName} · {entry.clientName}</small>
                </span>
                <em className={entry.days >= 14 ? "is-hot" : undefined}>{entry.days}d</em>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
