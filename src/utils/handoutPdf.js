// Build the takeaway as a designed PDF by capturing a React-rendered
// <HandoutPage> via html2canvas and embedding the result into jsPDF.
// Card-aware multi-page slicing: instead of cutting the canvas at
// fixed page-height intervals, we measure each reflection card's
// position and break pages just before a card that would otherwise
// straddle the seam. css `page-break-inside: avoid` doesn't help
// because html2canvas produces a single bitmap — we have to honour
// breakpoints manually.

function safeName(s) {
  return (s || 'Participant').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

const A4_PORTRAIT_W_PT = 595;
const A4_PORTRAIT_H_PT = 842;

export async function buildHandoutPdf({ userName, captureSelector = '.gr-takeaway' }) {
  const el = document.querySelector(captureSelector);
  if (!el) throw new Error(`Handout DOM "${captureSelector}" not found — make sure HandoutPage is mounted before calling.`);

  // Measure card top/bottom in CSS pixels relative to the container,
  // BEFORE running html2canvas (the captured canvas no longer has a
  // DOM to query). The slicer scales these to canvas pixels using
  // canvas.height / el.offsetHeight.
  const cssHeight = el.offsetHeight;
  const containerTop = el.getBoundingClientRect().top;
  const cardEls = Array.from(el.querySelectorAll('.gr-takeaway-card'));
  const cardCssBounds = cardEls.map(c => {
    const r = c.getBoundingClientRect();
    return { top: r.top - containerTop, bottom: r.bottom - containerTop };
  });

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#FBF4EE',
    useCORS: true,
    onclone: (clonedDoc) => {
      // html2canvas@1.4.x can't parse color-mix() / oklab — strip the
      // graduation level dot's halo on the clone before render.
      const dots = clonedDoc.querySelectorAll('.gr-plate-level-dot');
      dots.forEach(d => { d.style.boxShadow = 'none'; });
    },
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = A4_PORTRAIT_W_PT;
  const pageH = A4_PORTRAIT_H_PT;

  // Map CSS pixels → canvas pixels. The capture is at scale 2 but we
  // shouldn't assume — divide measured DOM height into canvas height.
  const cssToCanvas = canvas.height / cssHeight;
  const cardBounds = cardCssBounds.map(b => ({
    top: b.top * cssToCanvas,
    bottom: b.bottom * cssToCanvas,
  }));

  // Canvas pixels per PDF page.
  const pxPerPt = canvas.width / pageW;
  const fullPagePx = Math.floor(pageH * pxPerPt);
  // If a "natural" cut would leave less than 15% of a page filled, we'd
  // rather pack tighter than honour the card break. Otherwise the
  // break can sacrifice up to that much space to keep the card whole.
  const minPageFill = fullPagePx * 0.15;

  let posPx = 0;
  let pageIndex = 0;
  while (posPx < canvas.height) {
    const remainingPx = canvas.height - posPx;
    let endPx = Math.min(posPx + fullPagePx, canvas.height);

    // If endPx falls inside a card, back the cut up to that card's top.
    // Pick the LOWEST top that satisfies "would be cut by endPx" — the
    // last card before the cut.
    let breakAt = null;
    for (const b of cardBounds) {
      const startsBeforeEnd = b.top > posPx + 1 && b.top < endPx;
      const endsAfterEnd = b.bottom > endPx;
      if (startsBeforeEnd && endsAfterEnd) {
        if (breakAt === null || b.top < breakAt) breakAt = b.top;
      }
    }
    if (breakAt !== null && breakAt - posPx >= minPageFill) {
      endPx = breakAt;
    }
    // Don't cut into less than minPageFill on the last page either —
    // pack everything that's left into the final page if it'd be tiny.
    if (remainingPx <= fullPagePx) {
      endPx = canvas.height;
    }

    const thisSlicePx = endPx - posPx;
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = thisSlicePx;
    const ctx = slice.getContext('2d');
    ctx.fillStyle = '#FBF4EE';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, -posPx);

    const dataUrl = slice.toDataURL('image/png');
    const sliceHeightPt = thisSlicePx / pxPerPt;

    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(dataUrl, 'PNG', 0, 0, pageW, sliceHeightPt);

    posPx = endPx;
    pageIndex++;
  }

  return { doc: pdf, filename: `${safeName(userName)}_Foundry_Takeaway.pdf` };
}
