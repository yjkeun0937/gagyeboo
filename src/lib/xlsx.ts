import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * 엑셀(.xlsx) 읽기·쓰기. xlsx는 XML 파일을 묶은 zip이라, 필요한 부분(문자열·숫자·날짜)만 직접 다룬다.
 * 서식·수식은 읽지 않고 저장된 계산 결과 값만 쓴다. 파일은 브라우저 안에서만 처리한다.
 */

export type CellValue = string | number | null;

export interface Sheet {
  name: string;
  /** rows[행][열], 0부터. 값이 없으면 null. 날짜 서식 셀은 'YYYY-MM-DD' 글자로 돌려준다 */
  rows: CellValue[][];
  hidden: boolean;
}

export interface Workbook {
  sheets: Sheet[];
}

/* ───────── 읽기 ───────── */

const MAX_ROWS = 100_000;
const MAX_COLS = 200;

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
    }
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  });
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : undefined;
}

/** <t>…</t> 조각들을 이어 붙인다 (서식이 섞인 글자 <r>도 처리, 읽는 법 표기 <rPh>는 제외) */
function textOf(xml: string): string {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) out += decodeXml(m[1] ?? '');
  return out;
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function colLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/_./g, '')
    .replace(/\*./g, '');
  return /[ymd]/i.test(stripped);
}

/** 엑셀 날짜 번호(1900 체계) → 'YYYY-MM-DD'. 시각만 있는 값(1 미만)은 날짜가 아니므로 null */
export function serialToYmd(serial: number): string | null {
  if (!(serial >= 1) || serial > 2958465) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function ymdToSerial(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
}

function readStyles(xml: string | undefined): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  const nre = /<numFmt\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = nre.exec(xml))) {
    const id = Number(attr(m[1], 'numFmtId'));
    const code = attr(m[1], 'formatCode');
    if (Number.isFinite(id) && code !== undefined) custom.set(id, code);
  }
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  const out: boolean[] = [];
  const xre = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g;
  while ((m = xre.exec(block))) {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    out.push(custom.has(id) ? isDateFormatCode(custom.get(id)!) : BUILTIN_DATE_FMT.has(id));
  }
  return out;
}

function readShared(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textOf(m[1] ?? ''));
  return out;
}

function readSheetXml(xml: string, shared: string[], dateXf: boolean[]): CellValue[][] {
  const rows: CellValue[][] = [];
  const re = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) continue; // 값이 없는 칸
    const a = m[2];
    const body = m[3];
    const ref = /^([A-Za-z]+)(\d+)$/.exec(attr(a, 'r') ?? '');
    if (!ref) continue;
    const c = colIndex(ref[1]);
    const r = Number(ref[2]) - 1;
    if (r < 0 || r >= MAX_ROWS || c < 0 || c >= MAX_COLS) continue;
    const t = attr(a, 't');
    const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let val: CellValue = null;
    if (t === 'inlineStr') {
      val = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
    } else if (v !== undefined) {
      if (t === 's') val = shared[Number(v)] ?? null;
      else if (t === 'str') val = decodeXml(v);
      else if (t === 'b') val = Number(v) ? 1 : 0;
      else if (t === 'e') val = null;
      else if (t === 'd') val = decodeXml(v).slice(0, 10);
      else {
        const n = Number(v);
        if (Number.isFinite(n)) {
          const s = Number(attr(a, 's') ?? 0);
          val = dateXf[s] ? (serialToYmd(n) ?? n) : n;
        }
      }
    }
    if (val === null || val === '') continue;
    (rows[r] ??= [])[c] = val;
  }
  // 빈 칸을 null로 채워 직사각형에 가깝게 만든다
  for (let i = 0; i < rows.length; i++) {
    const row = (rows[i] ??= []);
    for (let j = 0; j < row.length; j++) if (row[j] === undefined) row[j] = null;
  }
  return rows;
}

export function readXlsx(bytes: Uint8Array): Workbook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/i.test(f.name),
    });
  } catch {
    throw new Error('엑셀(.xlsx) 파일이 아니거나 파일이 손상되었습니다');
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);
  const wbXml = text('xl/workbook.xml');
  if (!wbXml) throw new Error('엑셀(.xlsx) 파일이 아니거나 파일이 손상되었습니다 (워크북 정보 없음)');
  const rels = new Map<string, string>();
  const relXml = text('xl/_rels/workbook.xml.rels') ?? '';
  const rre = /<Relationship\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = rre.exec(relXml))) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  const shared = readShared(text('xl/sharedStrings.xml'));
  const dateXf = readStyles(text('xl/styles.xml'));
  const sheets: Sheet[] = [];
  const sre = /<sheet\b([^>]*)\/?>/g;
  while ((m = sre.exec(wbXml))) {
    const name = attr(m[1], 'name');
    const rid = attr(m[1], 'r:id') ?? attr(m[1], 'id');
    if (name === undefined || !rid) continue;
    const path = rels.get(rid);
    const xml = path ? text(path) : undefined;
    if (xml === undefined) continue; // 차트 시트 등
    sheets.push({
      name,
      rows: readSheetXml(xml, shared, dateXf),
      hidden: (attr(m[1], 'state') ?? 'visible') !== 'visible',
    });
  }
  return { sheets };
}

/* ───────── 쓰기 ───────── */

export type CellStyle = 'head' | 'num' | 'date' | 'bold' | 'boldnum' | 'title' | 'mute';

export interface WCell {
  v: string | number | null;
  s?: CellStyle;
}
export type WInput = WCell | string | number | null;

export interface WSheet {
  name: string;
  rows: WInput[][];
  /** 열 너비(글자 수) */
  widths?: number[];
  /** 위에서부터 고정할 줄 수 */
  freezeRows?: number;
}

const STYLE_ID: Record<CellStyle, number> = { head: 1, num: 2, date: 3, bold: 4, boldnum: 5, title: 6, mute: 7 };

function esc(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Malgun Gothic"/></font>
<font><b/><sz val="11"/><name val="Malgun Gothic"/></font>
<font><b/><sz val="14"/><name val="Malgun Gothic"/></font>
<font><sz val="10"/><color rgb="FF6B7785"/><name val="Malgun Gothic"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4ECF2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** 시트 이름 규칙: 31자 이하, [ ] : * ? / \ 금지, 중복 금지 */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || '시트';
  let n = base;
  let i = 2;
  while (used.has(n.toLowerCase())) {
    const suffix = ` (${i++})`;
    n = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(n.toLowerCase());
  return n;
}

function sheetXml(sh: WSheet): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  ];
  const f = sh.freezeRows ?? 0;
  parts.push(
    f > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${f}" topLeftCell="A${f + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>',
  );
  if (sh.widths?.length) {
    parts.push('<cols>');
    sh.widths.forEach((w, i) => parts.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`));
    parts.push('</cols>');
  }
  parts.push('<sheetData>');
  sh.rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((raw, c) => {
      const cell: WCell = raw !== null && typeof raw === 'object' ? raw : { v: raw };
      if (cell.v === null || cell.v === '') return;
      const ref = `${colLetter(c)}${r + 1}`;
      const s = cell.s ? ` s="${STYLE_ID[cell.s]}"` : '';
      if (typeof cell.v === 'number') {
        if (Number.isFinite(cell.v)) cells.push(`<c r="${ref}"${s}><v>${cell.v}</v></c>`);
      } else {
        cells.push(`<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`);
      }
    });
    if (cells.length) parts.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  });
  parts.push('</sheetData></worksheet>');
  return parts.join('');
}

export function writeXlsx(sheets: WSheet[]): Uint8Array {
  const used = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, used) }));
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, xml: string) => (files[path] = strToU8(xml));
  put(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      named
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('') +
      '</Types>',
  );
  put(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  put(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      named.map((s, i) => `<sheet name="${esc(s.name).replace(/"/g, '&quot;')}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  );
  put(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      named
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('') +
      `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  put('xl/styles.xml', STYLES_XML);
  named.forEach((s, i) => put(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zipSync(files, { level: 6 });
}
