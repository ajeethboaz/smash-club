import { useClub } from '../club';
import { api } from '../lib/api';
import { rupees, type PayStatus } from '../lib/engine';
import { Avatar, Icon } from '../ui';
import { AccountCard } from '../account';

export const STATUS_LABEL: Record<PayStatus, string> = {
  confirmed: 'Paid', marked: 'Marked paid', pending: 'Pending', 'not-playing': 'Not playing',
};

export default function Pay() {
  const { m, run } = useClub();
  const d = m.data;
  const money = m.money;
  const mo = d.months.find((x) => x.month === d.month);
  const monthName = new Date(`${d.month}T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' });
  const mine = money.status(d.me.id);
  const order: PayStatus[] = ['confirmed', 'marked', 'pending', 'not-playing'];
  const people = [...d.players].filter((p) => money.status(p.id) !== 'not-playing' || p.active)
    .sort((a, b) => order.indexOf(money.status(a.id)) - order.indexOf(money.status(b.id)));

  return (
    <div className="page">
      <div className="between"><h1 className="h1">Payments</h1><span className="small muted">{monthName}</span></div>

      <section className="card" style={{ background: 'var(--green)', color: '#F4F5EF', borderRadius: 28, padding: 22 }}>
        <span className="small" style={{ color: 'var(--soft-dark)' }}>Your share this month</span>
        <span className="num" style={{ fontSize: 48, color: 'var(--lime)' }}>{mine === 'not-playing' ? '—' : rupees(money.share)}</span>
        {mo && (
          <span className="small" style={{ color: 'var(--soft-dark)' }}>
            Court {rupees(Number(mo.court_fee))} + cork {rupees(Number(mo.cork_fee))}{Number(mo.other_fee) ? ` + other ${rupees(Number(mo.other_fee))}` : ''} = {rupees(money.total)} ÷ {money.players} players
          </span>
        )}
        {mine === 'pending' && <button className="btn btn-lime" onClick={() => run(() => api.markPaid(d.month), 'Marked as paid. Waiting for the admin to confirm.')}>I've paid</button>}
        {mine === 'marked' && <div className="row btn" style={{ background: 'var(--green-2)', justifyContent: 'center', fontSize: 15 }}><Icon name="clock" size={18} color="var(--lime)" />Marked paid · waiting for admin</div>}
        {mine === 'confirmed' && <div className="row btn" style={{ background: 'var(--green-2)', justifyContent: 'center', fontSize: 15 }}><Icon name="check" size={18} color="var(--lime)" width={3} />Paid · confirmed</div>}
        {mine === 'not-playing' && <span className="small">You're not on this month's list, so nothing to pay.</span>}
      </section>

      <section className="card" style={{ gap: 0, padding: '8px 16px' }}>
        <h2 className="h3" style={{ padding: '10px 0' }}>The crew</h2>
        {people.map((p) => {
          const st = money.status(p.id);
          return (
            <div key={p.id} className="list-row" style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ fontWeight: 700 }}><Avatar name={p.name} size={34} bg="var(--line)" fg="var(--ink)" />{p.id === d.me.id ? `${p.name} (you)` : p.name}</span>
              <span className={`status s-${st}`}>{STATUS_LABEL[st]}</span>
            </div>
          );
        })}
      </section>

      <div className="between small" style={{ padding: '0 4px' }}>
        <span className="muted">Collected</span><b>{rupees(money.collected)} of {rupees(money.total)}</b>
      </div>
      <AccountCard />
    </div>
  );
}
