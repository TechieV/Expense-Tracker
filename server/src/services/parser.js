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
const findCol = (headers, names) => headers.findIndex((h) => names.some((n) => norm(h).includes(n)));

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
  const iDebit = findCol(H, ['debit', 'withdrawal', 'withdraw', 'dr']);
  const iCredit = findCol(H, ['credit', 'deposit', 'cr']);
  const iAmount = findCol(H, ['amount']);
  const iType = H.findIndex((h) => ['type', 'drcr', 'crdr'].includes(norm(h)));
  const out = []; let skipped = 0;
  for (const r of records.slice(hi + 1)) {
    const date = parseDate(r[iDate]);
    if (!date) { skipped++; continue; }
    let amount = null; let type = null;
    const debit = iDebit >= 0 ? parseAmount(r[iDebit]) : null;
    const credit = iCredit >= 0 ? parseAmount(r[iCredit]) : null;
    if (debit && Math.abs(debit) > 0) { amount = Math.abs(debit); type = 'expense'; }
    else if (credit && Math.abs(credit) > 0) { amount = Math.abs(credit); type = 'income'; }
    else if (iAmount >= 0) {
      const a = parseAmount(r[iAmount]);
      if (a) {
        amount = Math.abs(a);
        const t = iType >= 0 ? String(r[iType]).toLowerCase() : '';
        if (/^(cr|credit|c)/.test(t)) type = 'income';
        else if (/^(dr|debit|d)/.test(t)) type = 'expense';
        else type = a < 0 ? 'expense' : 'income';
      }
    }
    if (!amount) { skipped++; continue; }
    out.push({ date, amount: round2(amount), type, description: String(r[iDesc] || '').replace(/\s+/g, ' ').trim().slice(0, 250) });
  }
  return { rows: out, skipped };
}

const NUM = /-?\d{1,3}(?:,\d{2,3})*\.\d{2}|-?\d+\.\d{2}/g;
const DATE_START = /^(\d{1,2}[/\-. ]\d{1,2}[/\-. ]\d{2,4}|\d{1,2}[-/ ][A-Za-z]{3}[a-z]*[-/ ,]*\d{2,4}|\d{4}-\d{2}-\d{2})\s+/;

// Rebuilds table rows from the PDF: items on the same line are joined left-to-right with a gap between columns
function renderPage(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: true }).then((tc) => {
    const items = tc.items.filter((i) => i.str.trim()).map((i) => ({ x: i.transform[4], y: i.transform[5], s: i.str.trim() }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.y - it.y) <= 3) row.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join('   ')).join('\n') + '\n';
  });
}

async function parsePdfStatement(buf) {
  let text;
  // Copy into a fresh Uint8Array: Node's pooled Buffers confuse the PDF reader
  try { text = (await pdfParse(new Uint8Array(buf), { version: 'v2.0.550', pagerender: renderPage })).text; }
  catch { throw new HttpError(422, 'This PDF could not be read'); }
  if (!text || text.trim().length < 30) throw new HttpError(422, 'No text found in this PDF. It may be a scanned statement (OCR is not enabled yet).');
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = []; let skipped = 0; let prevBalance = null; let last = null;
  for (const line of lines) {
    const dm = line.match(DATE_START);
    if (!dm) {
      // continuation of the previous narration (wrapped line without amounts)
      if (last && !line.match(NUM) && line.length < 80 && !/page|statement|balance|opening|closing|total/i.test(line)) last.description = `${last.description} ${line}`.trim().slice(0, 250);
      continue;
    }
    const date = parseDate(dm[1]);
    const rest = line.slice(dm[0].length);
    const nums = rest.match(NUM) || [];
    if (!date || nums.length < 1) { skipped++; last = null; continue; }
    let amount; let balance = null;
    if (nums.length >= 2) { balance = parseAmount(nums[nums.length - 1]); amount = Math.abs(parseAmount(nums[nums.length - 2])); }
    else amount = Math.abs(parseAmount(nums[0]));
    if (!amount) { skipped++; last = null; continue; }
    let type = null;
    if (balance !== null && prevBalance !== null) {
      if (Math.abs(prevBalance + amount - balance) < 0.02) type = 'income';
      else if (Math.abs(prevBalance - amount - balance) < 0.02) type = 'expense';
    }
    const lower = rest.toLowerCase();
    if (!type) {
      if (/\bcr\b|\bcredit\b|salary|deposit|refund|interest|cashback|received/.test(lower)) type = 'income';
      else type = 'expense';
    }
    if (balance !== null) prevBalance = balance;
    const description = rest.replace(NUM, ' ').replace(/\b(cr|dr)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 250);
    last = { date, amount: round2(amount), type, description };
    out.push(last);
  }
  return { rows: out, skipped };
}

export async function parseStatement(buf, ext) {
  const res = ext === 'pdf' ? await parsePdfStatement(buf) : parseCsvStatement(buf);
  if (!res.rows.length) throw new HttpError(422, 'No transactions could be found in this file');
  return res;
}
