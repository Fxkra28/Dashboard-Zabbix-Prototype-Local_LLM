# Server: export

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 30 min | [Server: live and assistant](server-live-and-assistant.md) | [Server: routes](server-routes.md) |

The monthly SLA report can be downloaded as a PDF, an Excel workbook or a zip of CSV files. All three are written by hand, with nothing but Node's built-in modules: no PDF library, no spreadsheet library, no zip library. The CSV writer (`csv.ts`) and the style (`style.ts`: a dot or a comma, three date shapes, a comma or a semicolon) are small and are described at the end of this chapter. The server image stays small, and the writers have no dependency to update. The cost is that the file formats are written out in the code, and that is what this chapter walks through. All of it is in `server/src/export/`, and `services/sliExport.ts` (in [the SLA chapter](server-sla-and-reports.md)) is what calls it.

## One document, two writers

The report is built once as a plain value, a `ReportDoc`, and both writers turn that same value into a file. Neither writer knows anything about SLAs, targets or Zabbix. Every figure reaches them already formatted, with the colour it should take. That keeps the PDF and the workbook saying the same thing, and keeps the writers reusable for the next report.

| File | What it does |
|---|---|
| `types.ts` | The document model: `ReportDoc`, `Table`, `Cell`, `Kpi`, `BarChart`, `Note` |
| `slaReport.ts` | Builds the `ReportDoc` from the two derived reports of one month |
| `pdf.ts` | The PDF writer: an A4 landscape file, hand-written PDF 1.4 |
| `pdfFonts.ts` | Text measuring for the PDF: the width of each character, wrapping and cutting |
| `logo.ts` | The logo for the PDF header, and a small PNG reader |
| `xlsx.ts` | The workbook writer: SpreadsheetML written by hand |
| `zip.ts` | A minimal ZIP writer, to package the workbook |
| `theme.ts` | The portal's colours, for files that cannot read a stylesheet |

### ReportDoc

`server/src/export/types.ts`. The shape both writers read.

<!-- gen:snippet server/src/export/types.ts#Cell sha=2f696d4f26bf -->
`server/src/export/types.ts:35-48`

```ts
export interface Cell {
  /**
   * What a person reads. Always set, so a missing figure still reads "No data"
   * rather than showing an empty box.
   */
  text: string;
  /**
   * The raw figure for the workbook, which stores numbers as numbers so they
   * sort and total: a percent as 0 to 100, a duration in seconds, a count as
   * is. Omitted for text and status cells, and null when there is no figure.
   */
  n?: number | null;
  tone?: Tone;
}
```
<!-- /gen -->

<!-- gen:snippet server/src/export/types.ts#ReportDoc sha=639501ac74b5 -->
`server/src/export/types.ts:106-125`

```ts
export interface ReportDoc {
  /** For example "SLA availability report". */
  title: string;
  /** For example "August 2026". */
  subtitle: string;
  /** The window the figures cover, with its time zone. */
  period: string;
  /** For example "Generated 1 Oct 2026 14:20, Asia/Jakarta". */
  generated: string;
  /** The line the page footer carries before the page number. */
  footer: string;
  /** File name without its extension, for example "HCML_SLA_Report_2026-08". */
  fileBase: string;
  kpis: Kpi[];
  chart?: BarChart;
  /** The tables, in reading order. */
  tables: Table[];
  /** How to read the report and how it was computed. */
  notes: Note[];
}
```
<!-- /gen -->

1. A `Cell` always has `text`, what a person reads, so a missing figure still reads "No data" and never shows an empty box. The raw figure `n` is for the workbook only, which stores numbers as numbers so they sort and total: a percent from 0 to 100, a duration in seconds, a count as it is. It is null when there is no figure, and left out for text and status cells.
2. A column has a `kind` (text, percent, duration, count or status), which decides its alignment and its number format, and a relative `weight`. The PDF scales the weights to the printable width and the workbook to character widths, so only the ratios matter.
3. A `Tone` (good, warn, bad, muted or none) is which of the portal's status colours a figure takes, from `theme.ts`.
4. A document is a title, a subtitle, the period and the time it was generated, the footer line, the file name without its extension, the key figures (`kpis`), an optional bar chart, the tables, and the notes that say how to read it and how it was computed.

### buildSlaReportDoc

`server/src/export/slaReport.ts`. Makes the document from the two reports of one month: the strict one and HCML's method.

<!-- gen:snippet server/src/export/slaReport.ts#buildSlaReportDoc lines=10-31 sha=a912fe77eafd -->
`server/src/export/slaReport.ts:502-523` (lines 10 to 31 of buildSlaReportDoc)

```ts
}
if (strict.from !== hcml.from || strict.to !== hcml.to) {
  throw new Error('The strict and HCML reports cover different periods.');
}

const at = clockIn(strict.timezone);
const d = style.date;
const subtitle = subtitleOf(strict, at, d);
const chart = chartOf(strict, style);
return {
  title: 'SLA availability report',
  subtitle,
  period: periodOf(strict, hcml, at, d),
  generated: `Generated ${stampText(at(now.getTime() / 1000), d)} (${strict.timezone})`,
  footer: `HCML Monitoring Portal · SLA availability report, ${subtitle}`,
  fileBase: fileBaseOf(strict, at),
  kpis: kpisOf(strict, hcml, style),
  ...(chart ? { chart } : {}),
  tables: [
    groupTable('By category', 'Category', strict, hcml, (r) => r.categories, style),
    groupTable('By site', 'Site', strict, hcml, (r) => r.sites, style),
    deviceTable(strict, hcml, style),
```
<!-- /gen -->

<!-- gen:snippet server/src/export/slaReport.ts#percentText sha=c48712aa05e9 -->
`server/src/export/slaReport.ts:58-67`

```ts
export function percentText(value: number | null, target: number, decimal: ReportStyle['decimal'] = 'dot'): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA;
  const met = value >= target;
  const digits = [2, 4, 6, 8].find((d) => (Number(fixedBelow100(value, d)) >= target) === met);
  // Closer to the target than eight decimals can show: cut instead of rounding.
  // 98.996 reads as such, not as 98.9960: the extra digits are only there to stay on the right side.
  const plain =
    digits === undefined ? (Math.trunc(value * 1e8) / 1e8).toFixed(8) : fixedBelow100(value, digits).replace(/(\.\d{2}\d*?)0+$/, '$1');
  return `${withMark(plain, decimal)}%`;
}
```
<!-- /gen -->

<!-- gen:snippet server/src/export/slaReport.ts#durationText sha=1501c97e2aa5 -->
`server/src/export/slaReport.ts:70-80`

```ts
export function durationText(seconds: number): string {
  if (!Number.isFinite(seconds)) return NO_DATA;
  const s = Math.round(Math.max(0, seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (m) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${s} s`;
}
```
<!-- /gen -->

1. The function is pure: no Zabbix, no settings, and no clock but the one it is handed, so the same two reports always give the same document. A test can build it and compare. It also takes a style (the decimal mark and the shape of a date), which defaults to the one every report was written in before styles existed; the style changes the words of a percent and of a date and nothing else, so the same two reports give the same figures, verdicts and rows in every style.
2. Before the lines quoted, it refuses reports that are mislabelled or do not match, because it would otherwise print one method's figures under the other's name: the first must be the `availability` profile, the second `hcml-report`, and both must cover the same period.
3. The tables are, in order: by category, by site, by device, the WAN paths, the web checks, and the devices that were never measured. A table with no rows shows its `empty` line in place.
4. The wording is the SLA page's own, copied from `features/sla/` in the web app, because the server cannot import the browser bundle. `export-sla-report.test.ts` fails if a copied sentence drifts.
5. `percentText` and `durationText` turn a figure into the words a person reads, and the cells of the tables are made with them. `percentText` takes the decimal mark as its third argument and writes the digits that keep a figure on its own side of the target in either mark (`98.996%` or `98,996%`). A figure below 100 is never written as `100.00%`: where rounding would reach it, the figure is cut instead, so `99.996` reads `99.99%` and 100 is only ever a figure of 100 (BK-46). The Assistant's snapshot uses `percentText` as well, with the default mark, so the model and the report write a percentage the same way.

Tests: `export-sla-report.test.ts`.

## The workbook

### zip

`server/src/export/zip.ts`. A workbook (`.xlsx`) is a ZIP of XML files, so the writer first needs a ZIP.

<!-- gen:snippet server/src/export/zip.ts#dosStamp sha=69377831dda2 -->
`server/src/export/zip.ts:20-27`

```ts
function dosStamp(now: Date): { date: number; time: number } {
  const year = now.getUTCFullYear(); // NaN for an invalid date, which fails both bounds below
  const d = year >= 1980 && year <= 2107 ? now : new Date(Date.UTC(1980, 0, 1));
  return {
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  };
}
```
<!-- /gen -->

<!-- gen:snippet server/src/export/zip.ts#pack sha=2d3b0bc27a8b -->
`server/src/export/zip.ts:30-34`

```ts
function pack(data: Buffer): { method: 0 | 8; body: Buffer } {
  // The default level: level 9 took four times as long on a large sheet for 5% fewer bytes, and this call blocks the event loop.
  const deflated = deflateRawSync(data);
  return deflated.length < data.length ? { method: 8, body: deflated } : { method: 0, body: data };
}
```
<!-- /gen -->

<!-- gen:snippet server/src/export/zip.ts#zip lines=2-11 sha=846970cdd322 -->
`server/src/export/zip.ts:37-46` (lines 2 to 11 of zip)

```ts
if (entries.length > MAX_ENTRIES) {
  throw new RangeError(`A zip holds at most ${MAX_ENTRIES} entries without zip64; got ${entries.length}.`);
}
// The content-types part leads so a reader that streams the package finds it first.
const ordered = [...entries.filter((e) => e.name === CONTENT_TYPES), ...entries.filter((e) => e.name !== CONTENT_TYPES)];
const { date, time } = dosStamp(now);
const seen = new Set<string>();
const locals: Buffer[] = [];
const centrals: Buffer[] = [];
let offset = 0;
```
<!-- /gen -->

<!-- gen:snippet server/src/export/zip.ts#zip lines=14-23 sha=846970cdd322 -->
`server/src/export/zip.ts:49-58` (lines 14 to 23 of zip)

```ts
const name = Buffer.from(entry.name, 'utf8');
if (name.length === 0 || name.length > 0xffff) throw new RangeError(`Bad zip entry name length: ${name.length}.`);
if (seen.has(entry.name)) throw new Error(`Duplicate zip entry: ${entry.name}`);
seen.add(entry.name);
if (entry.data.length >= MAX_BYTES) throw new RangeError(`Zip entry ${entry.name} is over 4 GiB; zip64 is not supported.`);

const { method, body } = pack(entry.data);
const crc = crc32(entry.data);
const needed = method === 8 ? 20 : 10;
const flags = 0x0800; // names are UTF-8
```
<!-- /gen -->

1. It writes plain ZIP only, without the zip64 extension. A report is a few megabytes, so a package that outgrows the 16-bit and 32-bit fields is a bug worth failing loudly on, and the function throws a `RangeError` rather than write a broken file.
2. `dosStamp` gives the date and time in the two 16-bit fields that ZIP uses, read in UTC, so the same `now` gives the same bytes anywhere. A date outside 1980 to 2107 becomes the 1980 start.
3. `pack` deflates a part, but stores it as it is when deflating would only add bytes. It uses the default level: level 9 took four times as long on a large sheet for 5 percent fewer bytes, and this call blocks the event loop.
4. The content-types part is put first, so a reader that streams the package finds it at once. Then each entry is checked: a name that is empty or too long, a duplicate, or a part over 4 GiB is an error. After the loop, the function writes the central directory and the end record.

Tests: `export-zip.test.ts`.

### buildXlsx

`server/src/export/xlsx.ts`. Writes a `ReportDoc` as SpreadsheetML (ECMA-376). Two rules shape the file. Every string goes through the shared string table, so a device named `=HYPERLINK(...)` stays text and is never evaluated as a formula. And the order of elements in each part follows the schema, because Excel repairs a file that breaks the order.

<!-- gen:snippet server/src/export/xlsx.ts#buildXlsx lines=2-25 sha=d5b80fb43c70 -->
`server/src/export/xlsx.ts:717-740` (lines 2 to 25 of buildXlsx)

```ts
// A bad clock is refused, not stamped as the epoch.
if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('The report time is not a valid date.');
const book: Book = { styles: new Styles(), strings: new SharedStrings() };
const footer = pageFooter(doc.footer);
const names = new SheetNames();

const sheets: { name: string; xml: string; filter?: string; titled: boolean }[] = [];
const summaryName = names.add('Summary');
sheets.push({
  name: summaryName,
  // Fitted to one printed page: fitted to the width alone, it left its last sentence by itself on a second.
  xml: summarySheet(book, doc).xml({ tab: PALETTE.primary, selected: true, footer, onePage: true }),
  titled: false,
});
for (const t of doc.tables) {
  const name = names.add(t.sheet);
  const { sheet, filter } = tableSheet(book, t);
  sheets.push({
    name,
    xml: sheet.xml({ tab: PALETTE.mid, freezeRow: HEADER_ROW, filter, footer }),
    filter,
    titled: true,
  });
}
```
<!-- /gen -->

<!-- gen:snippet server/src/export/xlsx.ts#buildXlsx lines=94-109 sha=d5b80fb43c70 -->
`server/src/export/xlsx.ts:809-824` (lines 94 to 109 of buildXlsx)

```ts
  const part = (name: string, xml: string) => ({ name, data: Buffer.from(xml, 'utf8') });
  return zip(
    [
      part('[Content_Types].xml', contentTypes),
      part('_rels/.rels', rootRels),
      part('docProps/core.xml', core),
      part('docProps/app.xml', app),
      part('xl/workbook.xml', workbook),
      part('xl/_rels/workbook.xml.rels', workbookRels),
      part('xl/styles.xml', book.styles.xml()),
      part('xl/sharedStrings.xml', book.strings.xml()),
      ...sheets.map((s, i) => part(`xl/worksheets/sheet${i + 1}.xml`, s.xml)),
    ],
    now,
  );
}
```
<!-- /gen -->

1. The workbook has a Summary sheet first, fitted to one printed page, and then one sheet for each table, with its header row frozen and a filter on it. The `SheetNames` helper makes each tab name legal: at most 31 characters, none of the square brackets, colon, asterisk, question mark, slash or backslash, unique whatever the case, and never Excel's reserved name History.
2. Between the two quoted parts the function writes the parts of the package as XML strings: the workbook with its defined names (the filter ranges and the print titles), the relationships, the content types, and the two property parts that name the creator.
3. The last step packages them with `zip`: the content types, the root relationships, the properties, the workbook, its relationships, the styles, the shared strings, and each sheet. A bad clock is refused with a `RangeError` and never stamped as the epoch.
4. A table sheet decides the width of each column from its content between a floor and a ceiling, and a row's height from how many lines its wrapped text needs. Durations are stored as seconds with the number format `[h]\:mm\:ss`, which Excel reads as hours that do not wrap at 24.

Tests: `export-xlsx.test.ts`, and `export-writers-agree.test.ts`, which checks that the workbook and the PDF carry the same figures.

## The PDF

### buildPdf

`server/src/export/pdf.ts`. A hand-written PDF 1.4 with the standard Helvetica fonts, so no font is embedded and the file stays small and opens the same everywhere. The page is A4 landscape.

<!-- gen:snippet server/src/export/pdf.ts#buildPdf lines=2-23 sha=161d26c70467 -->
`server/src/export/pdf.ts:767-788` (lines 2 to 23 of buildPdf)

```ts
if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('The report time is not a valid date.');
const layout = new Layout(doc);
layout.kpis(doc.kpis);
layout.chart(doc.chart);
for (const t of doc.tables) layout.table(t);
layout.notes(doc.notes);

const logo = logoImage();
layout.frame(logo);

const o = new Objects();
const catalog = o.reserve();
const tree = o.reserve();
const regular = o.reserve();
const bold = o.reserve();
const info = o.reserve();
const image = o.reserve();
const mask = logo.alpha ? o.reserve() : 0;
const outlines = layout.marks.length ? o.reserve() : 0;
const items = o.reserve(layout.marks.length);
const firstPage = o.reserve(layout.pages.length * 2);
const pageId = (i: number) => firstPage + i * 2;
```
<!-- /gen -->

<!-- gen:snippet server/src/export/pdf.ts#buildPdf lines=25-45 sha=161d26c70467 -->
`server/src/export/pdf.ts:790-810` (lines 25 to 45 of buildPdf)

```ts
o.set(regular, fontDict('Helvetica', 'regular'));
o.set(bold, fontDict('Helvetica-Bold', 'bold'));
const imageDict = `/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /BitsPerComponent 8 /Interpolate true`;
o.stream(image, `${imageDict} /ColorSpace /DeviceRGB /Filter /FlateDecode${mask ? ` /SMask ${mask} 0 R` : ''}`, logo.rgb);
if (logo.alpha) {
  const dict = `/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /BitsPerComponent 8`;
  o.stream(mask, `${dict} /ColorSpace /DeviceGray /Filter /FlateDecode`, logo.alpha);
}

layout.pages.forEach((page, i) => {
  const content = pageId(i) + 1;
  o.stream(content, '/Filter /FlateDecode', deflateSync(Buffer.from(page.ops.join('\n'), 'latin1'), { level: 9 }));
  const xobjects = i === 0 ? ` /XObject << /Im1 ${image} 0 R >>` : '';
  o.set(
    pageId(i),
    `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${content} 0 R ` +
      `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >>${xobjects} >> >>`,
  );
});
const kids = layout.pages.map((_, i) => `${pageId(i)} 0 R`).join(' ');
o.set(tree, `<< /Type /Pages /Kids [${kids}] /Count ${layout.pages.length} >>`);
```
<!-- /gen -->

<!-- gen:snippet server/src/export/pdf.ts#buildPdf lines=47-67 sha=161d26c70467 -->
`server/src/export/pdf.ts:812-832` (lines 47 to 67 of buildPdf)

```ts
if (outlines) {
  o.set(outlines, `<< /Type /Outlines /First ${items} 0 R /Last ${items + layout.marks.length - 1} 0 R /Count ${layout.marks.length} >>`);
  layout.marks.forEach((m, i) => {
    const links = [i > 0 ? `/Prev ${items + i - 1} 0 R` : '', i < layout.marks.length - 1 ? `/Next ${items + i + 1} 0 R` : ''];
    const dest = `[${pageId(m.page)} 0 R /XYZ ${MARGIN} ${n(PAGE_H - m.top + 4)} null]`;
    o.set(items + i, `<< /Title ${textString(m.title)} /Parent ${outlines} 0 R ${links.join(' ')} /Dest ${dest} >>`);
  });
}

const title = `${doc.title}, ${doc.subtitle}`;
o.set(
  info,
  `<< /Title ${textString(title)} /Subject ${textString(doc.period)} /Author (HCML Monitoring Portal) ` +
    `/Creator (HCML Monitoring Portal) /Producer (HCML Monitoring Portal PDF writer) ` +
    `/CreationDate (${pdfDate(now)}) /ModDate (${pdfDate(now)}) >>`,
);
o.set(
  catalog,
  `<< /Type /Catalog /Pages ${tree} 0 R /Lang (en-US) /ViewerPreferences << /DisplayDocTitle true >>${outlines ? ` /Outlines ${outlines} 0 R` : ''} >>`,
);
return o.write(catalog, info);
```
<!-- /gen -->

1. The page is laid out in full first, by the `Layout` class: the key figures, the chart, each table and the notes, then the frame with the logo and the footers. Only then is "Page x of y" known, so the footers are drawn last, and the file is written out after that. Coordinates in the layout run down from the top of the page and are flipped to the PDF's bottom-up axis when drawn.
2. A PDF is a numbered list of objects that refer to one another. The function reserves the numbers first, through `Objects`, so that the page tree can name pages that are written later.
3. It then writes the two fonts, the logo image and its transparency mask, and, for each page, a compressed content stream and a page object. The first page alone carries the logo.
4. The outline, the list of marks that a viewer shows as bookmarks, links one table to the next with Prev and Next entries. The document information names the portal as the creator and the producer, and the catalog sets the title to show in the viewer's window.

Tests: `export-pdf.test.ts`.

### wrapText and the font widths

`server/src/export/pdfFonts.ts`. The PDF uses the standard Helvetica and Helvetica-Bold, which no viewer needs embedded. So the writer has to know how wide each character is, to right-align, centre, wrap and cut text.

<!-- gen:snippet server/src/export/pdfFonts.ts#toWinAnsi sha=a655540a34cc -->
`server/src/export/pdfFonts.ts:71-80`

```ts
export function toWinAnsi(s: string): WinAnsiText {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const u = ch.codePointAt(0)!;
    if (u === 9 || u === 10 || u === 13) out += ' ';
    else if ((u >= 32 && u < 127) || (u >= 160 && u <= 255)) out += ch;
    else out += String.fromCharCode(CODE_OF.get(u) ?? 63);
  }
  return out as WinAnsiText;
}
```
<!-- /gen -->

<!-- gen:snippet server/src/export/pdfFonts.ts#textWidth sha=0f4eb4e4c931 -->
`server/src/export/pdfFonts.ts:87-91`

```ts
export function textWidth(s: WinAnsiText, face: FontFace, size: number): number {
  let units = 0;
  for (let i = 0; i < s.length; i++) units += advance(s.charCodeAt(i), face);
  return (units * size) / 1000;
}
```
<!-- /gen -->

<!-- gen:snippet server/src/export/pdfFonts.ts#wrapText sha=feed4ca27ec7 -->
`server/src/export/pdfFonts.ts:117-142`

```ts
export function wrapText(s: WinAnsiText, face: FontFace, size: number, maxWidth: number): WinAnsiText[] {
  const lines: string[] = [];
  let line = '';
  const push = (word: string) => {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next as WinAnsiText, face, size) <= maxWidth) {
      line = next;
      return;
    }
    if (line) lines.push(line);
    line = '';
    let rest = word;
    while (rest.length > 1) {
      const fits = fitCount(rest, face, size, maxWidth);
      if (fits === rest.length) break;
      // At least one character goes on a line, even a glyph wider than the line.
      const end = Math.max(fits, 1);
      lines.push(rest.slice(0, end));
      rest = rest.slice(end);
    }
    line = rest;
  };
  for (const word of s.split(' ')) if (word) push(word);
  if (line) lines.push(line);
  return lines as WinAnsiText[];
}
```
<!-- /gen -->

1. The widths are Adobe's core-14 advances, 1,000 units to the em, for the WinAnsi codes 32 to 255. They were checked against Arial and Arial Bold, which are metric compatible with Helvetica, measured in headless Chrome.
2. Text moves through the writer as WinAnsi text: a string in which every character code is the byte the PDF will draw, so measuring and drawing agree. `toWinAnsi` converts a string and is the only way to make one, which the `WinAnsiText` type enforces, so the measuring functions cannot be handed text that was never converted.
3. `wrapText` fills a line word by word until the next word would pass `maxWidth`. A word wider than a whole line is cut by characters, at least one on each line, even for a glyph wider than the line. `wrapParagraph` and `wrapWords`, next to it, add a rule that a paragraph never ends on a single word.

### decodePng

`server/src/export/logo.ts`. The server image does not carry `web/public`, so the logo is embedded in the file as base64, and a test fails if that copy drifts from the original. A PDF image wants raw pixels, so the file also holds a small PNG reader.

<!-- gen:snippet server/src/export/logo.ts#decodePng lines=2-31 sha=a148404a4555 -->
`server/src/export/logo.ts:462-491` (lines 2 to 31 of decodePng)

```ts
if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file');
let width = 0;
let height = 0;
let depth = 0;
let colourType = -1;
let interlace = 0;
let palette: Buffer | null = null;
let paletteAlpha: Buffer | null = null;
const idat: Buffer[] = [];
for (let pos = 8; pos + 8 <= png.length; ) {
  const length = png.readUInt32BE(pos);
  const kind = png.toString('latin1', pos + 4, pos + 8);
  const data = png.subarray(pos + 8, pos + 8 + length);
  if (kind === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    depth = data[8]!;
    colourType = data[9]!;
    interlace = data[12]!;
  } else if (kind === 'PLTE') palette = data;
  else if (kind === 'tRNS') paletteAlpha = data;
  else if (kind === 'IDAT') idat.push(data);
  else if (kind === 'IEND') break;
  pos += 12 + length;
}
const channels = CHANNELS[colourType];
if (!channels || depth !== 8 || interlace !== 0 || !width || !height) {
  throw new Error(`Unsupported PNG: colour type ${colourType}, ${depth} bit, interlace ${interlace}`);
}
if (colourType === 3 && !palette) throw new Error('PNG palette is missing');
```
<!-- /gen -->

<!-- gen:snippet server/src/export/logo.ts#unfilter sha=1fbe64e633a7 -->
`server/src/export/logo.ts:434-458`

```ts
function unfilter(raw: Buffer, height: number, stride: number, bpp: number): Buffer {
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? out[dst + i - bpp]! : 0;
      const up = y > 0 ? out[dst - stride + i]! : 0;
      const upLeft = y > 0 && i >= bpp ? out[dst - stride + i - bpp]! : 0;
      const x = raw[src + i]!;
      let v: number;
      switch (type) {
        case 0: v = x; break;
        case 1: v = x + left; break;
        case 2: v = x + up; break;
        case 3: v = x + ((left + up) >> 1); break;
        case 4: v = x + paeth(left, up, upLeft); break;
        default: throw new Error(`PNG row ${y} has filter type ${type}`);
      }
      out[dst + i] = v & 255;
    }
  }
  return out;
}
```
<!-- /gen -->

1. `decodePng` reads the chunks of the file: the header (width, height, depth, colour type, interlace), the palette and its transparency, and the image data, which may be in several chunks.
2. It reads only what the logo needs, and anything else throws: 8 bits a channel, no interlace, and colour type 0, 2, 3 or 6. A file it cannot read throws, so the export fails and never produces a damaged picture.
3. `unfilter` undoes PNG's per-row filters (types 0 to 4, including Paeth) on the inflated rows, and the rest of `decodePng` turns each pixel into RGB bytes and, for colour type 6 or a palette with transparency, a separate alpha channel, which the PDF stores as a soft mask.

Tests: `export-pdf.test.ts`.

## The colours

`server/src/export/theme.ts` holds the portal's colours for files that cannot read a stylesheet. The ink, the fills and the lines of status are copied from the light-theme token block at the top of `web/src/styles/01-tokens.css`, and `export-theme.test.ts` fails if one drifts, so a report and the screen it came from stay the same blue. Reports are printed and attached to e-mail, so they take the light theme whatever the viewer's screen uses. The paper is the exception. Since 26 October 2026 the screen's page and cards are one soft plane with depth, which a printed page cannot show and an Excel cell cannot take as a translucent line. So a report keeps white paper, its own light rows and solid lines: the four `PAPER` entries, which are not copies of a token.

## The CSV zip and the style

The third writer is `csv.ts`, and it reads the same document as the other two. It turns the document into a list of files, builds the zip with the same `zip.ts` the workbook uses, and so adds no library.

1. `csvEntries(doc, style)` returns the files without zipping them, which is what most of its tests read. The first is `00-summary.csv`: the report's title and month, the period, the time of generation, then each key figure with its detail. Then one file for each table, numbered in reading order and named for the table's sheet (`01-by-category.csv`), with accents dropped from the name and a table whose name has no letter in it called `table`. The last is `notes.txt`. All of them sit in a folder named for the report and `_csv`, so that unzipping does not scatter files over a folder.
2. A table becomes a header row and one row for each row of the table, then its closing row if it has one. A table with no rows is its header alone, and `notes.txt` says why, in the same words the other writers print for an empty table. A table with no columns is refused with the words the PDF and the workbook use.
3. A figure is written for a spreadsheet to total. A percent is the figure as the report prints it without the sign, so a CSV and a PDF agree to the digit; a duration is whole seconds; a count is the count. A figure that is missing is a blank and never a zero, and the Status column still says *No data* in words. The header says the unit (`in %`, `in seconds`).
4. A text cell is cleaned of control characters and padding, and a name that starts with `=`, `+`, `-` or `@` gets an apostrophe in front of it, so that a spreadsheet does not run it as a formula. This is the one risk a CSV has that the other two files do not.
5. A field is put in quotes when it holds the separator or a quote, and the quote is doubled. The files start with a byte order mark so that Excel reads UTF-8, and every line ends with CR and LF.

`style.ts` holds the three choices and nothing else. The report document is built with a style in hand (`buildSlaReportDoc(strict, hcml, now, style)`): the decimal mark goes into every percent and the dates into the lines that hold one, and **no figure, verdict, tone or row changes**. The document carries the chart's target and axis labels as text already written, so the PDF writer needs no style. The workbook stores a number as a number and reads the decimals a percent shows from its text, in either style, so a figure never loses the digits that keep it on its own side of the target. The cache of built files is keyed on the style, except that a PDF or a workbook ignores the separator.
