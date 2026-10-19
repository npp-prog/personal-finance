/*
 * Minimal Excel (.xlsx) reader for bank statement uploads: returns the first worksheet as rows of
 * strings, with date cells as YYYY-MM-DD. No dependencies: unzips with the browser's
 * DecompressionStream and reads the XML with DOMParser. Old binary .xls files are not supported.
 */
(function () {
  'use strict';

  async function inflate(bytes, method) {
    if (method === 0) return bytes;
    if (method !== 8) throw new Error('Unsupported compression in this Excel file.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Map of file name -> function returning its text. */
  function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This is not an .xlsx file. In Excel use File → Save As → CSV, then upload that.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      files[name] = async () => dec.decode(await inflate(u8.subarray(start, start + size), method));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  const xml = (text) => new DOMParser().parseFromString(text, 'application/xml');
  const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));

  function colIndex(ref) {
    let n = 0;
    for (const ch of String(ref).replace(/\d+/g, '')) n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
    return n - 1;
  }

  function serialToISO(v) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
    return d.toISOString().slice(0, 10);
  }

  // Built-in number formats that are dates, plus custom formats with day/month/year codes.
  const DATE_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
  function dateStyles(stylesDoc) {
    const custom = {};
    for (const f of all(stylesDoc, 'numFmt')) {
      const code = (f.getAttribute('formatCode') || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
      custom[+f.getAttribute('numFmtId')] = /[dy]/i.test(code) || /m{1,4}.*[dy]|[dy].*m/i.test(code);
    }
    const cellXfs = all(stylesDoc, 'cellXfs')[0];
    return cellXfs ? all(cellXfs, 'xf').map((xf) => {
      const id = +xf.getAttribute('numFmtId');
      return DATE_IDS.has(id) || !!custom[id];
    }) : [];
  }

  async function firstSheetPath(files) {
    try {
      const wb = xml(await files['xl/workbook.xml']());
      const sheet = all(wb, 'sheet')[0];
      const rid = sheet && (sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      const rels = xml(await files['xl/_rels/workbook.xml.rels']());
      const rel = all(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid);
      if (rel) {
        const t = rel.getAttribute('Target').replace(/^\//, '');
        const path = t.startsWith('xl/') ? t : 'xl/' + t;
        if (files[path]) return path;
      }
    } catch (e) { /* fall back below */ }
    return Object.keys(files).filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
  }

  async function readXlsx(buf) {
    const files = unzip(buf);
    const path = await firstSheetPath(files);
    if (!path) throw new Error('No worksheet found in this Excel file.');
    const shared = files['xl/sharedStrings.xml']
      ? all(xml(await files['xl/sharedStrings.xml']()), 'si').map((si) => all(si, 't').map((t) => t.textContent).join(''))
      : [];
    const isDate = files['xl/styles.xml'] ? dateStyles(xml(await files['xl/styles.xml']())) : [];
    const rows = [];
    for (const r of all(xml(await files[path]()), 'row')) {
      const row = [];
      for (const c of all(r, 'c')) {
        const ref = c.getAttribute('r');
        const i = ref ? colIndex(ref) : row.length;
        const t = c.getAttribute('t');
        const v = all(c, 'v')[0];
        let val = '';
        if (t === 's') val = v ? shared[+v.textContent] || '' : '';
        else if (t === 'inlineStr') val = all(c, 't').map((x) => x.textContent).join('');
        else if (v) {
          val = v.textContent;
          const num = Number(val);
          if ((!t || t === 'n') && !isNaN(num)) {
            val = isDate[+c.getAttribute('s') || 0] && num > 0 && num < 2958466 ? serialToISO(num) : String(+num.toFixed(10));
          }
        }
        while (row.length < i) row.push('');
        row[i] = val;
      }
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
    }
    return rows;
  }

  window.PundoXlsx = { read: readXlsx };
})();
