// Build the takeaway as a designed PDF by capturing a React-rendered
// <HandoutPage> via html2canvas and embedding the result into jsPDF.
// Multi-page slicing handles content longer than one A4 page — the
// reflections doc grows with the number of stages the participant
// reflected on, so we can't crop to a single page like a one-pager.
//
// Image-based PDF (same approach the certificate uses): not text-
// searchable, but renders exactly as styled.

function safeName(s) {
  return (s || 'Participant').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

const A4_PORTRAIT_W_PT = 595;
const A4_PORTRAIT_H_PT = 842;

export async function buildHandoutPdf({ userName, captureSelector = '.gr-takeaway' }) {
  const el = document.querySelector(captureSelector);
  if (!el) throw new Error(`Handout DOM "${captureSelector}" not found — make sure HandoutPage is mounted before calling.`);

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#FBF4EE',
    useCORS: true,
    onclone: (clonedDoc) => {
      // html2canvas@1.4.x can't parse color-mix() / oklab and throws
      // when it hits one. Strip the level-dot's halo on the cloned DOM
      // before render. (Unrelated to the takeaway today, but the same
      // gotcha lives on the broader graduation page.)
      const dots = clonedDoc.querySelectorAll('.gr-plate-level-dot');
      dots.forEach(d => { d.style.boxShadow = 'none'; });
    },
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = A4_PORTRAIT_W_PT;
  const pageH = A4_PORTRAIT_H_PT;

  // Scale factor between source canvas pixels and PDF points.
  const pxPerPt = canvas.width / pageW;
  const sliceHeightPx = Math.floor(pageH * pxPerPt);

  let posPx = 0;
  let pageIndex = 0;
  while (posPx < canvas.height) {
    const remainingPx = canvas.height - posPx;
    const thisSlicePx = Math.min(sliceHeightPx, remainingPx);

    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = thisSlicePx;
    const ctx = slice.getContext('2d');
    // Cream backfill so any sub-pixel gap at the slice edge doesn't
    // show as white on the PDF page.
    ctx.fillStyle = '#FBF4EE';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, -posPx);

    const dataUrl = slice.toDataURL('image/png');
    const sliceHeightPt = thisSlicePx / pxPerPt;

    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(dataUrl, 'PNG', 0, 0, pageW, sliceHeightPt);

    posPx += thisSlicePx;
    pageIndex++;
  }

  return { doc: pdf, filename: `${safeName(userName)}_Foundry_Takeaway.pdf` };
}
