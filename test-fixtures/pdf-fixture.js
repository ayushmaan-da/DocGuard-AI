export function createPdf(pages = ['DocGuard PDF fixture'], { encrypted = false } = {}) {
  const pageObjects = [];
  const fontObjectNumber = 3 + pages.length * 2;
  for (let index = 0; index < pages.length; index += 1) {
    const pageObjectNumber = 3 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    const escapedText = String(pages[index]).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    const stream = pages[index] === ''
      ? ''
      : `BT /F1 12 Tf 50 700 Td (${escapedText}) Tj ET`;
    pageObjects.push([
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ]);
  }

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ...pageObjects.flat(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let trailer = `<< /Size ${objects.length + 1} /Root 1 0 R`;
  if (encrypted) {
    objects.push('<< /Filter /Standard /V 1 /R 2 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> /P -4 >>');
    trailer = `<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt ${objects.length} 0 R`;
  }
  trailer += ' >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n${trailer}\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}
