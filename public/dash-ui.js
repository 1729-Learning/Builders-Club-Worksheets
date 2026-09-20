/*
  HTML-string helpers and the handful of stroke icons the views use.

  Views build strings and hand them to one innerHTML per render — the same shape
  the worksheets app uses. Everything user-supplied goes through esc(); a student
  who types "<script>" into an answer must not become a bug.
*/
'use strict';

/* eslint-disable no-var */
var ui = (function () {
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const pct = n => Math.round((n || 0) * 100) + '%';
  const num = n => (n == null ? '—' : String(n));
  const one = n => (n == null ? '—' : String(Math.round(n * 10) / 10));

  /* Dates come out of a Builder file as an ISO stamp or a plain date. Render them
     the same everywhere, and never invent precision the file doesn't have. */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '—';
    return `${+m[3]} ${MONTHS[+m[2] - 1]}`;
  }
  function dayYear(iso) {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '—';
  }

  const icon = {
    // Hand-drawn strokes, currentColor, no emoji — the same vocabulary as the
    // command dashboard's icons.tsx.
    flag: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 21V4h9l-1 3h6v9h-8l-1-3H5"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 13l5 5L20 6"/></svg>',
    arrow: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    back: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H6M11 6l-6 6 6 6"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg>',
    grid: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>',
    link: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4 4 0 0 1 0-6l2-2a4 4 0 0 1 6 6l-1 1"/><path d="M14 10a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-6-6l1-1"/></svg>',
    print: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7"/><path d="M7 16h10v4H7z"/></svg>',
  };

  const card = (inner, cls) => `<section class="card ${cls || ''}">${inner}</section>`;

  // No tone → a neutral ink spine. Colour is only added where it means something,
  // so a row of stats isn't four unrelated colours competing for attention.
  const stat = (n, label, sub, tone) => `
    <div class="stat ${tone || ''}">
      <div class="stat-n">${esc(n)}</div>
      <div class="stat-l">${esc(label)}</div>
      ${sub ? `<div class="stat-s">${esc(sub)}</div>` : ''}
    </div>`;

  const pill = (text, tone) => `<span class="pill ${tone || ''}">${esc(text)}</span>`;

  const chip = (text, opts) => {
    const o = opts || {};
    return `<button class="chip ${o.on ? 'on' : ''} ${o.cls || ''}" ${o.attr || ''}>${esc(text)}${o.count != null ? ` <span class="dim">${o.count}</span>` : ''}</button>`;
  };

  const minibar = (fraction, cls) => `<span class="minibar ${cls || ''}"><i style="width:${Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100)}%"></i></span>`;

  const segbar = states => `<div class="segbar">${states.map(s => `<i class="${s}"></i>`).join('')}</div>`;

  /* An answer box that says which kind of nothing it is: not started, or not
     readable because only the digest was restored from a previous session. */
  function answerBox(text, opts) {
    const o = opts || {};
    if (o.digestOnly) return `<div class="answer empty">Open this step to read the answers.</div>`;
    if (!text || !text.trim()) return `<div class="answer empty">Nothing written yet.</div>`;
    return `<div class="answer">${esc(text)}</div>`;
  }

  /* The review as the student saw it: their attempt, then what Builders AI said
     back, in the worksheets' own bubbles. Folded away by default — a mentor opens
     it when the final answer alone doesn't explain what happened. */
  function threadHTML(step, opts) {
    const o = opts || {};
    const rounds = (step.rounds || []).filter(r => !o.skipLast || r.n !== step.rounds.length);
    if (!rounds.length) return '';
    const label = step.status === 'inProgress'
      ? `What Builders AI has said so far (${rounds.length})`
      : `How they got there — ${rounds.length} attempt${rounds.length === 1 ? '' : 's'}`;
    return `
      <details class="fold">
        <summary>${esc(label)}</summary>
        <div class="thread">
          ${rounds.map(r => bubbles(r)).join('')}
        </div>
      </details>`;
  }

  function bubbles(r) {
    const mine = `
      <div class="msg user">
        <span class="msg-avatar">🙂</span>
        <div class="msg-body">
          <div class="msg-tag">Attempt ${r.n}${r.sameAsFinal ? ' · the answer above' : ''}</div>
          ${r.sameAsFinal ? '<div class="msg-text dim">Same as the accepted answer.</div>' : `<div class="msg-text">${esc(r.text)}</div>`}
        </div>
      </div>`;
    const theirs = r.feedback ? `
      <div class="msg agent ${r.passed ? 'good' : 'bad'}">
        <span class="msg-avatar">${r.passed ? '✓' : '↺'}</span>
        <div class="msg-body">
          <div class="msg-tag">Builders AI${r.passed ? ' · accepted' : ''}</div>
          <div class="msg-text">${esc(r.feedback)}</div>
        </div>
      </div>` : '';
    return mine + theirs;
  }

  /* One step, rendered the way the worksheet renders it. */
  function stepCard(step, curriculumStep, opts) {
    const o = opts || {};
    const stuck = step.status === 'inProgress' && step.attempts >= 3;
    const cls = step.status === 'done' ? 'is-done' : step.status === 'mastered' ? 'is-mastered' : stuck ? 'is-stuck' : 'is-open';
    const meta = step.status === 'done'
      ? (step.accepted ? `passed on attempt ${step.attempts}` : 'done') + (step.completedOn ? ` · ${day(step.completedOn)}` : '')
      : step.status === 'mastered' ? 'skipped by Builders AI · no XP'
      : `${step.attempts} attempt${step.attempts === 1 ? '' : 's'} so far · not accepted yet`;

    return `
      <section class="wstep ${cls}">
        <div class="wstep-head">
          <span class="wstep-num">${o.num != null ? o.num : ''}</span>
          <div style="flex:1 1 auto;min-width:0">
            <h3 class="wstep-title">${esc(curriculumStep.title)}</h3>
            <div class="wstep-meta">${esc(meta)}</div>
          </div>
          ${o.rightHTML || ''}
        </div>
        <div class="wstep-body">
          <p class="prompt">${esc(curriculumStep.prompt)}</p>
          ${step.status === 'mastered'
            ? `<div class="answer empty">${esc(step.masteredReason || 'Builders AI let them skip this.')}</div>`
            : answerBox(step.answer, { digestOnly: o.digestOnly })}
          ${step.status === 'inProgress' && step.inProgressFeedback ? `
            <div class="thread" style="margin-top:var(--s3)">
              <div class="msg agent bad">
                <span class="msg-avatar">↺</span>
                <div class="msg-body"><div class="msg-tag">Builders AI · latest</div><div class="msg-text">${esc(step.inProgressFeedback)}</div></div>
              </div>
            </div>` : ''}
          ${threadHTML(step, { skipLast: step.status === 'inProgress' })}
        </div>
      </section>`;
  }

  const escapeAttr = s => esc(s).replace(/\n/g, ' ');

  const emptyState = (title, body, actionHTML) => `
    <div class="empty-state">
      <h2>${esc(title)}</h2>
      <p class="lede" style="margin:6px auto 14px">${esc(body)}</p>
      ${actionHTML || ''}
    </div>`;

  /* CSV for the gradebook. Quotes everything, because student names and answers
     contain commas and newlines. */
  function csv(rows) {
    const cell = v => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return rows.map(r => r.map(cell).join(',')).join('\r\n');
  }

  const copyText = text => navigator.clipboard.writeText(text);

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return { esc, escapeAttr, pct, num, one, day, dayYear, icon, card, stat, pill, chip, minibar, segbar, answerBox, threadHTML, bubbles, stepCard, emptyState, csv, copyText, download };
}());

if (typeof module !== 'undefined' && module.exports) module.exports = ui;
if (typeof window !== 'undefined') window.ui = ui;
