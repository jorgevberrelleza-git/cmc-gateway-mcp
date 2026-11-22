import assert from 'node:assert/strict';
import fs from 'node:fs';
import { translatePlannedOrder, buildLimitIoc, collarPrice } from '../src/learning/bitso-order-spec.mjs';
import { makePgOrderJournal } from '../src/learning/order-journal-pg.mjs';

// --- Translation: planner order -> exact limit-IOC spec.
const id = n => 'shadow-' + String(n).repeat(24).slice(0, 24);
const sellBtc = translatePlannedOrder({ book: 'btc_usd', asset: 'BTC', side: 'sell', major: 0.01249, clientOrderId: id(1) }, { bid: 59000, ask: 59010 });
assert.deepEqual(sellBtc, { book: 'btc_usd', side: 'sell', major: '0.01249000', price: '58705', notionalUsd: 733.23, originId: id(1) });
const buyAda = translatePlannedOrder({ book: 'ada_usd', asset: 'ADA', side: 'buy', major: 11500.123456, clientOrderId: id(2) }, { bid: 0.1414, ask: 0.1415 });
assert.equal(buyAda.major, '11500.12'); assert.equal(buyAda.price, '0.14220'); assert.equal(Number(buyAda.price), (collarPrice({ side: 'buy', bid: 0.1414, ask: 0.1415, collarPct: 0.5, book: 'ada_usd' })));
assert.ok(Number(buyAda.price) <= 0.1415 * 1.005);
// Caps and validation are the same rules the live client enforces.
assert.throws(() => buildLimitIoc({ book: 'btc_usd', side: 'buy', major: 1, price: 59000, originId: id(3) }), /above_max_order_usd/);
assert.throws(() => buildLimitIoc({ book: 'btc_usd', side: 'buy', major: 0.00001, price: 59000, originId: id(3) }), /below_min_order_usd/);
assert.throws(() => buildLimitIoc({ book: 'aave_usd', side: 'buy', major: 1, price: 90, originId: id(3) }), /book_not_allowed/);
assert.throws(() => translatePlannedOrder({ book: 'btc_usd', side: 'sell', major: 0.01, clientOrderId: 'x' }, { bid: 1, ask: 1 }), /bad_origin_id/);

// --- Journal on a fake Postgres that enforces the PRIMARY KEY like the real table.
function fakeDb({ failInsert = false } = {}) {
  const rows = new Map(); const log = [];
  return { rows, log, async query(sql, p = []) {
    log.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (/^insert into shadow_order_journal/i.test(sql.trim())) {
      if (failInsert) throw new Error('relation "shadow_order_journal" does not exist');
      if (rows.has(p[0])) return { rowCount: 0, rows: [] };
      rows.set(p[0], { mode: p[1], state: p[2], book: p[3], side: p[4], major: p[5], price: p[6] }); return { rowCount: 1, rows: [{ origin_id: p[0] }] };
    }
    if (/^update shadow_order_journal set state='UNKNOWN'/i.test(sql.trim())) { const r = rows.get(p[0]); if (r && r.mode === p[1]) r.state = 'UNKNOWN'; return { rowCount: r ? 1 : 0 }; }
    if (/^select count\(\*\)::int as n from shadow_order_journal/i.test(sql.trim())) return { rows: [{ n: [...rows.values()].filter(r => r.mode === p[0] && r.state === 'UNKNOWN').length }] };
    return { rows: [], rowCount: 0 };
  } };
}
const db = fakeDb();
const rj = makePgOrderJournal(db, { mode: 'REHEARSAL', snapshotId: 1 });
assert.equal(await rj.appendIfAbsent(sellBtc.originId, sellBtc), true);
assert.equal(await rj.appendIfAbsent(sellBtc.originId, sellBtc), false, 'PRIMARY KEY prevents a second record');
assert.equal(db.rows.get(sellBtc.originId).state, 'REHEARSED');
// Concurrent appends of the same id: exactly one wins.
const both = await Promise.all([rj.appendIfAbsent(id(5), buyAda), rj.appendIfAbsent(id(5), buyAda)]);
assert.deepEqual(both.sort(), [false, true]);
// Rehearsal UNKNOWNs never block LIVE, and vice versa.
await rj.markUnknown(id(5));
const lj = makePgOrderJournal(db, { mode: 'LIVE' });
assert.equal(await rj.unresolvedCount(), 1); assert.equal(await lj.unresolvedCount(), 0);
assert.equal(await lj.appendIfAbsent(id(6), sellBtc), true); assert.equal(db.rows.get(id(6)).state, 'PLANNED');
assert.throws(() => makePgOrderJournal(db, { mode: 'PAPER' }), /bad_mode/);

// --- Migration matches the journal and the spec (books, id pattern, states).
const sql = fs.readFileSync(new URL('../learning/migrations/006_shadow_order_journal.sql', import.meta.url), 'utf8');
for (const s of ["origin_id text primary key", "'REHEARSAL','LIVE'", "'REHEARSED'", "'UNKNOWN'", "'btc_usd','ada_usd'", "^shadow-[a-f0-9]{24}$"]) assert.ok(sql.includes(s), 'migration has ' + s);

// --- The dry-run runner stays isolated from the trade client.
const runner = fs.readFileSync(new URL('./learning-executor.mjs', import.meta.url), 'utf8');
assert.ok(!/trade-client|trade_client|tradeClient/.test(runner));
assert.ok(runner.includes("savepoint rehearsal") && runner.includes("rollback to savepoint rehearsal"), 'rehearsal isolated in a savepoint');

console.log('SHADOW_ORDER_JOURNAL_SELFTEST=' + JSON.stringify({ ok: true, translationMatchesLiveRules: true, primaryKeyDedup: true, concurrentAppendOneWins: true, rehearsalIsolatedFromLive: true, migrationConsistent: true }));
