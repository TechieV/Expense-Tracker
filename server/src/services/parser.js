import { parse as parseCsv } from 'csv-parse/sync';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { HttpError, isValidDate, round2 } from '../util.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** Parses the date formats Indian bank statements use. Day-first for ambiguous dates (03/04/2026 = 3 April). */
export function parseDate(raw) {
  const s = String(raw || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) return fix(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})/))) return fix(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[a-z]*[-/. ,]*(\d{2,4})/))) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) return fix(+m[3] < 100 ? 2000 + +m[3] : +m[3], mon, +m[1]);
  }
  return null;
}
function fix(y, mo, d) { const s = `${y}-${pad(mo)}-${pad(d)}`; return isValidDate(s) ? s : null; }

export function parseAmount(raw) {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[^\d.]/g, '');
  if (!s || s === '.') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z]/g, '');
const findCol = (headers, names, exclude = []) =>
  headers.findIndex((h, idx) =>
    !exclude.includes(idx) &&
    names.some((n) =>
      n.length <= 2
        ? norm(h) === n || new RegExp(`\\b${n}\\b`, 'i').test(h)
        : norm(h).includes(n)
    )
  );

function parseCsvStatement(buf) {
  let records;
  try { records = parseCsv(buf.toString('utf8').replace(/^\uFEFF/, ''), { relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true }); }
  catch { throw new HttpError(422, 'This CSV file could not be read'); }
  // Bank CSVs often have a few lines of account info before the header row
  const hi = records.findIndex((r) => r.some((c) => norm(c).includes('date')) && r.some((c) => /desc|narr|partic|detail|remark/.test(norm(c))));
  if (hi < 0) throw new HttpError(422, 'Could not find a header row with Date and Description/Narration columns');
  const H = records[hi];
  const iDate = findCol(H, ['date']);
  const iDesc = findCol(H, ['description', 'narration', 'particulars', 'details', 'remarks']);
  const iDebit = findCol(H, ['debit', 'withdrawal', 'withdraw', 'dr'], [iDesc]);
  const iCredit = findCol(H, ['credit', 'deposit', 'cr'], [iDesc]);
  const iAmount = findCol(H, ['amount'], [iDesc, iDebit, iCredit]);
  const iBalance = findCol(H, ['balance', 'bal', 'closingbalance'], [iDesc, iDebit, iCredit, iAmount]);
  const iType = H.findIndex((h, idx) => idx !== iDesc && ['type', 'drcr', 'crdr'].includes(norm(h)));
  const out = []; let skipped = 0;
  for (const r of records.slice(hi + 1)) {
    const date = parseDate(r[iDate]);
    if (!date) { skipped++; continue; }
    let amount = null; let type = null;
    const debit = iDebit >= 0 ? parseAmount(r[iDebit]) : null;
    const credit = iCredit >= 0 ? parseAmount(r[iCredit]) : null;
    const bal = iBalance >= 0 ? parseAmount(r[iBalance]) : null;
    if (debit && Math.abs(debit) > 0) { amount = Math.abs(debit); type = 'expense'; }
    else if (credit && Math.abs(credit) > 0) { amount = Math.abs(credit); type = 'income'; }
    else if (iAmount >= 0) {
      const a = parseAmount(r[iAmount]);
      if (a) {
        amount = Math.abs(a);
        const t = iType >= 0 ? String(r[iType]).toLowerCase().trim() : '';
        if (/^(cr|credit|c|deposit|income)/.test(t)) type = 'income';
        else if (/^(dr|debit|d|withdrawal|expense)/.test(t)) type = 'expense';
        else type = a < 0 ? 'expense' : 'income';
      }
    }
    if (!amount) { skipped++; continue; }
    out.push({
      date,
      amount: round2(amount),
      type,
      balance: bal !== null ? round2(bal) : null,
      description: String(r[iDesc] || '').replace(/\s+/g, ' ').trim().slice(0, 250),
    });
  }
  const rowsWithBal = out.filter((r) => r.balance !== null);
  const closingBalance = rowsWithBal.length > 0 ? rowsWithBal[rowsWithBal.length - 1].balance : null;
  return { rows: out, skipped, closingBalance };
}

const NUM = /-?\b\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\b|-?\b\d+(?:\.\d{1,2})?\b/g;
const DATE_PATTERN = /(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/\-. ]\d{1,2}[/\-. ]\d{2,4}|\d{1,2}[-/ ][A-Za-z]{3}[a-z]*[-/ ,]*\d{2,4})/;

// Rebuilds table rows from the PDF: items on the same line are joined left-to-right with a gap between columns
function renderPage(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: true }).then((tc) => {
    const items = (tc.items || [])
      .filter((i) => i && typeof i.str === 'string' && i.str.trim() && Array.isArray(i.transform) && i.transform.length >= 6)
      .map((i) => ({ x: i.transform[4], y: i.transform[5], s: i.str.trim() }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.y - it.y) <= 4.5) row.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join('   ')).join('\n') + '\n';
  });
}

const DISCLAIMER_RE = /page\s+\d+|statement generated|account summary|particulars|opening balance|closing balance|end of statement|signature|stamp|assistance|contact us|remember|customer care|helpline|branch|never share|sensitive information|safe banking|kotak mahindra|bank ltd|important information|inaccurate|cin:|pin,\s*cvv|tax invoice|goods and services|gst|schedule of features|commonly used|inoperative account|account no\b|nominee|dear customer/i;
const HEADER_METADATA_RE = /(account type|nominee registered|savings account transactions|crn\s*x+|ifsc code|micr\s*\d+|account status|currency indian rupee)/i;

async function parsePdfStatement(buf) {
  let text;
  // Copy into a fresh Uint8Array: Node's pooled Buffers confuse the PDF reader
  try { text = (await pdfParse(new Uint8Array(buf), { version: 'v2.0.550', pagerender: renderPage })).text; }
  catch { throw new HttpError(422, 'This PDF could not be read'); }
  if (!text || text.trim().length < 30) throw new HttpError(422, 'No text found in this PDF. It may be a scanned statement (OCR is not enabled yet).');
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = []; let skipped = 0; let prevBalance = null; let last = null;
  let tableStarted = false;

  for (const line of lines) {
    if (!tableStarted) {
      if (/opening balance|#\s*date|date\s+description|transactions/i.test(line)) {
        tableStarted = true;
      }
      continue;
    }

    if (HEADER_METADATA_RE.test(line)) continue;
    if (/closing balance|opening balance|end of statement|statement generated|page\s+\d+\s+of/i.test(line)) {
      last = null;
      continue;
    }

    const dm = line.match(DATE_PATTERN);
    const pos = dm ? line.indexOf(dm[0]) : -1;
    const isHeader = pos >= 0 && /page|statement|period|balance|account|opening|closing|total/i.test(line.slice(0, pos));
    if (!dm || pos > 20 || isHeader) {
      // continuation of the previous narration (wrapped line without amounts)
      if (last && !line.match(NUM) && line.length < 80 && !DISCLAIMER_RE.test(line)) {
        last.description = `${last.description} ${line}`.trim().slice(0, 250);
      }
      continue;
    }
    const date = parseDate(dm[1]);
    const afterDate = line.slice(pos + dm[0].length);
    const rawNums = (afterDate.match(NUM) || []).map((n) => parseAmount(n)).filter((n) => n !== null && Math.abs(n) > 0);
    if (!date || rawNums.length === 0) { skipped++; last = null; continue; }
    let amount; let balance = null;
    if (rawNums.length >= 2) {
      balance = rawNums[rawNums.length - 1];
      amount = Math.abs(rawNums[rawNums.length - 2]);
    } else {
      amount = Math.abs(rawNums[0]);
    }
    if (!amount) { skipped++; last = null; continue; }
    let type = null;
    if (balance !== null && prevBalance !== null) {
      if (Math.abs(prevBalance + amount - balance) < 0.05) type = 'income';
      else if (Math.abs(prevBalance - amount - balance) < 0.05) type = 'expense';
    }
    const lower = afterDate.toLowerCase();
    if (!type) {
      if (/\b(cr|credit|salary|deposit|refund|interest|cashback|received)\b/i.test(lower)) type = 'income';
      else if (/\b(dr|debit|withdrawal|withdraw)\b/i.test(lower)) type = 'expense';
      else type = 'expense';
    }
    if (balance !== null) prevBalance = balance;
    const description = afterDate.replace(NUM, ' ').replace(/\b(cr|dr)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 250);
    last = {
      date,
      amount: round2(amount),
      type,
      balance: balance !== null ? round2(balance) : null,
      description: description || 'Bank Transaction',
    };
    out.push(last);
  }
  const rowsWithBal = out.filter((r) => r.balance !== null);
  const closingBalance = rowsWithBal.length > 0 ? rowsWithBal[rowsWithBal.length - 1].balance : null;
  return { rows: out, skipped, closingBalance };
}

export async function parseStatement(buf, ext) {
  const res = ext === 'pdf' ? await parsePdfStatement(buf) : parseCsvStatement(buf);
  if (!res.rows.length) throw new HttpError(422, 'No transactions could be found in this file');
  return res;
}
