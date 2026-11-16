import { useEffect, useState } from 'react';
import { useClub } from '../club';
import { api } from '../lib/api';
import { rupees, type PayStatus } from '../lib/engine';
import { Avatar, Icon } from '../ui';

export const STATUS_LABEL: Record<PayStatus, string> = {
  confirmed: 'Paid', part: 'Part paid', marked: 'Marked paid', pending: 'Pending', 'not-playing': 'Not playing',
};

/** Pay: everyone sees their share and who has paid. Admins also set the month's costs and record payments here. */
export default function Pay() {
  const { m, run } = useClub();
  const d = m.data;
  const admin = d.me.is_admin;

  // Which month we're looking at: this month by default, ‹ › to go back.
  const [month, setMonth] = useState(d.month);
  const shift = (ym: string, by: number) => {
    const t = new Date(`${ym}T00:00:00Z`); t.setUTCMonth(t.getUTCMonth() + by);
    return t.toISOString().slice(0, 10);
  };
  const earliest = d.months[0]?.month ?? d.month;
  // Admins can go back up to a year (to set up a month the app didn't track yet); players see months that exist.
  const canPrev = admin ? month > shift(d.month, -12) : month > earliest;
  const canNext = month < d.month;
  const isNow = month === d.month;
  const money = isNow ? m.money : m.moneyFor(month);
  const mo = d.months.find((x) => x.month === month);
  const monthName = new Date(`${month}T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' });
  const monthYear = new Date(`${month}T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const mine = money.status(d.me.id);
  const order: PayStatus[] = ['pending', 'marked', 'part', 'confirmed', 'not-playing'];
  const people = [...d.players].filter((p) => money.status(p.id) !== 'not-playing' || (isNow && p.active))
    .sort((a, b) => order.indexOf(money.status(a.id)) - order.indexOf(money.status(b.id)) || a.name.localeCompare(b.name));
  const toCollect = people.filter((p) => ['pending', 'marked', 'part'].includes(money.status(p.id))).length;

  // Admin: costs form and part payments
  const [editCosts, setEditCosts] = useState(false);
  const [fees, setFees] = useState({ court: '0', cork: '0', other: '0' });
  useEffect(() => {
    setFees({ court: String(mo?.court_fee ?? 0), cork: String(mo?.cork_fee ?? 0), other: String(mo?.other_fee ?? 0) });
    setEditCosts(!mo && admin); // a month with no costs yet opens straight into the form
    setPartFor(null);
  }, [month, mo, admin]);
  const splitN = mo ? money.players : d.players.filter((p) => p.active).length;
  const inLineup = (id: string) => d.lineup.some((x) => x.month === month && x.player_id === id && x.playing);
  const [partFor, setPartFor] = useState<string | null>(null);
  const [partAmt, setPartAmt] = useState('');
  const total = Number(fees.court) + Number(fees.cork) + Number(fees.other);

  return (
    <div className="screen" style={{ gap: 18 }}>
      <header className="stack" style={{ gap: 12 }}>
        <h1 className="h1">Payments</h1>
        <div className="between panel" style={{ padding: '4px 4px', flexDirection: 'row' }}>
          <button className="round-btn" aria-label="Previous month" disabled={!canPrev} onClick={() => setMonth(shift(month, -1))} style={{ opacity: canPrev ? 1 : .3 }}><Icon name="back" size={18} width={2.4} /></button>
          <span className="stack" style={{ alignItems: 'center', gap: 0 }}>
            <b style={{ fontSize: 16 }}>{monthYear}</b>
            {!isNow && <button className="link-quiet" style={{ padding: 0, fontSize: 12 }} onClick={() => setMonth(d.month)}>Back to this month</button>}
          </span>
          <button className="round-btn" aria-label="Next month" disabled={!canNext} onClick={() => setMonth(shift(month, 1))} style={{ opacity: canNext ? 1 : .3 }}><Icon name="chevron" size={18} width={2.4} /></button>
        </div>
      </header>

      {!mo && (
        <section className="card">
          <b>No costs set for {monthName}</b>
          <span className="small muted">{admin ? `The app wasn't tracking ${monthName} yet. Enter the costs below, then confirm who paid.` : `Nothing was tracked in the app for ${monthName}.`}</span>
        </section>
      )}

      {/* ── Your share ── */}
      {mo && <section className="card" style={{ background: 'var(--green)', color: '#F4F5EF', borderRadius: 24, padding: 22 }}>
        <span className="small" style={{ color: 'var(--soft-dark)' }}>Your share {isNow ? 'this month' : `for ${monthName}`}</span>
        <span className="num" style={{ fontSize: 48, color: 'var(--lime)' }}>{mine === 'not-playing' ? '—' : rupees(money.share)}</span>
        {mo && (
          <span className="small" style={{ color: 'var(--soft-dark)' }}>
            Court {rupees(Number(mo.court_fee))} + cork {rupees(Number(mo.cork_fee))}{Number(mo.other_fee) ? ` + other ${rupees(Number(mo.other_fee))}` : ''} = {rupees(money.total)} ÷ {money.players} players
          </span>
        )}
        {mine === 'pending' && <button className="btn btn-lime" onClick={() => run(() => api.markPaid(month), 'Marked as paid. Waiting for the admin to confirm.')}>I've paid</button>}
        {mine === 'marked' && <div className="row btn" style={{ background: 'var(--green-2)', justifyContent: 'center', fontSize: 15 }}><Icon name="clock" size={18} color="var(--lime)" />Marked paid · waiting for admin</div>}
        {mine === 'part' && <div className="row btn" style={{ background: 'var(--green-2)', justifyContent: 'center', fontSize: 15 }}><Icon name="clock" size={18} color="var(--lime)" />Paid {rupees(money.paid(d.me.id))} · {rupees(money.due(d.me.id))} left</div>}
        {mine === 'confirmed' && <div className="row btn" style={{ background: 'var(--green-2)', justifyContent: 'center', fontSize: 15 }}><Icon name="check" size={18} color="var(--lime)" width={3} />Paid · confirmed</div>}
        {mine === 'not-playing' && <span className="small">You weren't on {monthName}'s list, so nothing to pay.</span>}
      </section>}

      {/* ── Month's costs (admin) ── */}
      {admin && (mo || editCosts) && (
        <section className="panel">
          <button className="prow" aria-expanded={editCosts} onClick={() => setEditCosts((v) => !v)}>
            <span className="stack" style={{ gap: 2 }}>
              <b>{monthName} costs</b>
              <span className="small muted">{mo ? `${rupees(money.total)} split between ${money.players} · admin only` : 'Not set yet · admin only'}</span>
            </span>
            <span className="row" style={{ gap: 6, color: 'var(--muted)', fontSize: 14 }}><Icon name="gear" size={18} />{editCosts ? 'Close' : 'Edit'}</span>
          </button>
          {editCosts && (
            <div className="stack" style={{ gap: 12, padding: '4px 0 16px' }}>
              <div className="grid3">
                {([['court', 'Court'], ['cork', 'Cork'], ['other', 'Other']] as const).map(([k, label]) => (
                  <div className="field" key={k}>
                    <label htmlFor={`fee-${k}`}>{label} (₹)</label>
                    <input id={`fee-${k}`} className="input" inputMode="decimal" value={fees[k]} onChange={(e) => setFees({ ...fees, [k]: e.target.value.replace(/[^\d.]/g, '') })} />
                  </div>
                ))}
              </div>
              {mo && (
                <div className="stack" style={{ gap: 0 }}>
                  <span className="section-label" style={{ padding: '4px 0 6px' }}>Who played (and splits the cost)</span>
                  {d.players.filter((p) => p.active || inLineup(p.id)).map((p) => (
                    <div key={p.id} className="between" style={{ padding: '6px 0' }}>
                      <span style={{ color: inLineup(p.id) ? 'var(--ink)' : 'var(--muted)' }}>{p.name}</span>
                      <button className="switch" role="switch" aria-checked={inLineup(p.id)} aria-label={`${p.name} played in ${monthName}`}
                        onClick={() => run(() => api.admin.setPlaying(month, p.id, !inLineup(p.id)))}><span /></button>
                    </div>
                  ))}
                </div>
              )}
              <span className="small muted">{rupees(total)} ÷ {splitN} playing = {rupees(splitN ? total / splitN : 0)} each</span>
              <button className="btn btn-green btn-sm" onClick={async () => {
                const ok = await run(async () => {
                  await api.admin.saveMonth({ month, court_fee: Number(fees.court), cork_fee: Number(fees.cork), other_fee: Number(fees.other) });
                  // A new month starts with everyone who's playing now; switch anyone off above.
                  if (!mo) for (const p of d.players.filter((x) => x.active)) await api.admin.setPlaying(month, p.id, true);
                }, mo ? 'Costs saved' : `${monthName} set up. Now confirm who paid.`);
                if (ok && mo) setEditCosts(false);
              }}>{mo ? 'Save costs' : `Set up ${monthName}`}</button>
            </div>
          )}
        </section>
      )}

      {/* ── Who has paid ── */}
      {mo && <section className="stack" style={{ gap: 10 }}>
        <div className="between" style={{ alignItems: 'baseline' }}>
          <span className="section-label">The crew</span>
          <span className="small muted">Total {rupees(money.total)}</span>
        </div>
        <div className="grid2">
          <div className="stat"><b style={{ color: 'var(--ok)', fontSize: 24 }}>{rupees(money.collected)}</b><span>Collected</span></div>
          <div className="stat"><b style={{ color: money.total - money.collected > 0.005 ? 'var(--warn)' : 'var(--muted)', fontSize: 24 }}>{rupees(Math.max(0, money.total - money.collected))}</b><span>Pending · {toCollect} {toCollect === 1 ? 'person' : 'people'}</span></div>
        </div>
        {admin && toCollect > 0 && <span className="tiny muted">Tap Confirm when someone pays in full, or Part if they paid some of it.</span>}
        <div className="panel">
          {people.map((p) => {
            const st = money.status(p.id);
            const editing = admin && partFor === p.id;
            const label = st === 'part' ? `${rupees(money.paid(p.id))} of ${rupees(money.share)}` : STATUS_LABEL[st];
            const savePart = () => {
              const amt = Number(partAmt);
              if (!amt) return;
              setPartFor(null);
              const full = amt >= money.share - 0.005;
              void run(() => api.admin.confirmPayment(month, p.id, true, full ? null : amt),
                full ? `${p.name} has paid in full` : `${p.name}: ${rupees(amt)} paid, ${rupees(money.share - amt)} left`);
            };
            return (
              <div key={p.id} className="prow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                <div className="between" style={{ gap: 10 }}>
                  <span className="row" style={{ gap: 10, minWidth: 0 }}>
                    <Avatar name={p.name} size={34} bg="var(--line)" fg="var(--ink)" />
                    <span className="stack" style={{ gap: 3, minWidth: 0 }}>
                      <b>{p.id === d.me.id ? `${p.name} (you)` : p.name}</b>
                      <span className={`status s-${st}`} style={{ alignSelf: 'flex-start' }}>{label}</span>
                    </span>
                  </span>
                  {admin && st !== 'not-playing' && !editing && (
                    st === 'confirmed' ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.admin.confirmPayment(month, p.id, false, null))}>Undo</button>
                    ) : (
                      <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setPartFor(p.id); setPartAmt(st === 'part' ? String(money.paid(p.id)) : ''); }}>{st === 'part' ? 'Edit' : 'Part'}</button>
                        <button className="btn btn-green btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => run(() => api.admin.confirmPayment(month, p.id, true, null), `${p.name}'s payment confirmed`)}>{st === 'part' ? 'Rest paid' : 'Confirm'}</button>
                      </span>
                    )
                  )}
                </div>
                {editing && (
                  <div className="row" style={{ gap: 8 }}>
                    <input className="input" autoFocus inputMode="decimal" aria-label={`Amount ${p.name} has paid so far`} placeholder={`Paid so far, of ${rupees(money.share)}`}
                      value={partAmt} onChange={(e) => setPartAmt(e.target.value.replace(/[^\d.]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && savePart()} style={{ flexGrow: 1, minWidth: 0 }} />
                    <button className="btn btn-green btn-sm" disabled={!Number(partAmt)} onClick={savePart}>Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPartFor(null)}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>}
    </div>
  );
}
