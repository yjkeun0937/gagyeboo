import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readXlsx, writeXlsx, serialToYmd, ymdToSerial, colLetter } from '../src/lib/xlsx';

describe('xlsx 쓰기·읽기', () => {
  it('글자·숫자·날짜가 그대로 돌아온다', () => {
    const bytes = writeXlsx([
      {
        name: '시트1',
        rows: [
          [{ v: '날짜', s: 'head' }, '글자 & <특수> "문자"', { v: 1234567, s: 'num' }],
          [{ v: ymdToSerial('2026-03-05'), s: 'date' }, '줄\n바꿈', { v: 0.5, s: 'num' }],
          [null, null, 'C3'],
        ],
      },
      { name: '둘째', rows: [['a']] },
    ]);
    const wb = readXlsx(bytes);
    expect(wb.sheets.map((s) => s.name)).toEqual(['시트1', '둘째']);
    const r = wb.sheets[0].rows;
    expect(r[0]).toEqual(['날짜', '글자 & <특수> "문자"', 1234567]);
    expect(r[1]).toEqual(['2026-03-05', '줄\n바꿈', 0.5]);
    expect(r[2]).toEqual([null, null, 'C3']);
  });

  it('시트 이름의 금지 문자와 중복을 고친다', () => {
    const wb = readXlsx(writeXlsx([{ name: 'a/b:c', rows: [['x']] }, { name: 'a/b:c', rows: [['y']] }]));
    expect(wb.sheets.map((s) => s.name)).toEqual(['a b c', 'a b c (2)']);
  });

  it('엑셀이 만든 파일의 특징을 읽는다: 공유 문자열·서식 있는 글자·날짜 서식·빈 칸', () => {
    const files: Record<string, Uint8Array> = {
      'xl/workbook.xml': strToU8(
        '<workbook xmlns:r="x"><sheets><sheet name="2026-3" sheetId="1" r:id="rId1"/><sheet name="숨김" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(
        '<sst><si><t>날짜</t></si><si><r><t>롯데</t></r><r><t xml:space="preserve"> 마트</t></r></si><si><t>a&amp;b</t><rPh sb="0" eb="1"><t>ㅂ</t></rPh></si></sst>',
      ),
      'xl/styles.xml': strToU8(
        '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="[$-412]\\ m&quot;월&quot;\\ d&quot;일&quot;\\ \\(ddd\\)"/></numFmts>' +
          '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
          '<row r="2"><c r="A2" s="1"><v>46086</v></c><c r="B2"/><c r="C2" s="0"><f>SUM(1,2)</f><v>3</v></c><c r="D2" t="str"><f>x</f><v>식</v></c></row>' +
          '<row r="3"><c r="A3" s="2"><v>46087.75</v></c><c r="C3" t="inlineStr"><is><t>인라인</t></is></c><c r="E3" t="b"><v>1</v></c></row>' +
          '</sheetData></worksheet>',
      ),
      'xl/worksheets/sheet2.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>'),
    };
    const wb = readXlsx(zipSync(files));
    expect(wb.sheets[0].hidden).toBe(false);
    expect(wb.sheets[1].hidden).toBe(true);
    const r = wb.sheets[0].rows;
    expect(r[0]).toEqual(['날짜', '롯데 마트', 'a&b']);
    expect(r[1]).toEqual(['2026-03-05', null, 3, '식']);
    expect(r[2]).toEqual(['2026-03-06', null, '인라인', null, 1]);
    expect(wb.sheets[1].rows[0]).toEqual([7]);
  });

  it('엑셀 파일이 아니면 이해되는 오류를 낸다', () => {
    expect(() => readXlsx(strToU8('hello'))).toThrow(/엑셀/);
    expect(() => readXlsx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/엑셀/);
  });

  it('날짜 번호 변환', () => {
    expect(serialToYmd(46086)).toBe('2026-03-05');
    expect(ymdToSerial('2026-03-05')).toBe(46086);
    expect(serialToYmd(0.5)).toBeNull();
    expect(colLetter(0)).toBe('A');
    expect(colLetter(26)).toBe('AA');
  });
});
