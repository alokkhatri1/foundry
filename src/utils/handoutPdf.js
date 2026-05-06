// Build the takeaway as a designed, brand-styled PDF by capturing a
// React-rendered <HandoutPage> via html2canvas and embedding it into
// jsPDF. Multi-page slicing happens here: render the full handout at
// A4 portrait width, capture, then carve the resulting canvas into
// page-height slices that each become a PDF page.
//
// Same image-based-PDF tradeoff as the certificate: the document is
// not text-searchable, but the typography, colour, blockquote rules,
// step cards, etc. all render exactly as styled. For a workshop
// keepsake that prioritises visual polish, this is the right call.

function safeName(s) {
  return (s || 'Participant').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

// A4 portrait at 72dpi (jsPDF unit: pt). We render the DOM at a wider
// pixel size for crispness and let html2canvas's internal scale + the
// PDF's 595pt page width do the resampling.
const A4_PORTRAIT_W_PT = 595;
const A4_PORTRAIT_H_PT = 842;

export async function buildHandoutPdf({ userName, captureSelector = '.gr-handout' }) {
  const el = document.querySelector(captureSelector);
  if (!el) throw new Error(`Handout DOM "${captureSelector}" not found — make sure HandoutPage is mounted before calling.`);

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  // Capture the whole handout at 2x for crisp rendering at A4 size.
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#FBF4EE',
    useCORS: true,
    // Same fix as the certificate path — html2canvas@1.4.x throws on
    // color-mix() / oklab. Strip box-shadows on cloned DOM before render.
    onclone: (clonedDoc) => {
      const dots = clonedDoc.querySelectorAll('.gr-plate-level-dot');
      dots.forEach(d => { d.style.boxShadow = 'none'; });
    },
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = A4_PORTRAIT_W_PT;
  const pageH = A4_PORTRAIT_H_PT;

  // Scale factor: how many canvas pixels equal one PDF point.
  // canvas.width pixels span pageW points → 1 pt = canvas.width / pageW px.
  const pxPerPt = canvas.width / pageW;
  const sliceHeightPx = Math.floor(pageH * pxPerPt);

  let posPx = 0;
  let pageIndex = 0;
  while (posPx < canvas.height) {
    const remainingPx = canvas.height - posPx;
    const thisSlicePx = Math.min(sliceHeightPx, remainingPx);

    // Carve a slice of the source canvas into a temp canvas.
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = thisSlicePx;
    const ctx = slice.getContext('2d');
    // Fill with the cream background so any sub-pixel artifacts at the
    // bottom of the last slice don't show as white.
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
