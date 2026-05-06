// Build the takeaway as a designed PDF. The cover (eyebrow + title +
// meta) stamps the top of every page, and the closer (brand mark +
// generated-by line) stamps the bottom of every page. The reflection
// cards fill the variable middle, paginating with card-aware breaks
// so a single card never splits across the seam.
//
// Implementation: capture the whole .gr-takeaway DOM once, then carve
// the resulting canvas into three regions — cover, cards, closer —
// using the elements' measured top/bottom positions. The cards region
// is sub-sliced per PDF page; cover and closer are addImage'd at the
// same coords on every page.

function safeName(s) {
  return (s || 'Participant').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

const A4_PORTRAIT_W_PT = 595;
const A4_PORTRAIT_H_PT = 842;

// Carve a sub-canvas from a source canvas at [fromY, toY) in canvas px.
// Backfills cream so any sub-pixel artifact reads as page bg, not white.
function subCanvas(src, fromY, toY) {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = Math.max(1, Math.floor(toY - fromY));
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#FBF4EE';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, -fromY);
  return out;
}

export async function buildHandoutPdf({ userName, captureSelector = '.gr-takeaway' }) {
  const el = document.querySelector(captureSelector);
  if (!el) throw new Error(`Handout DOM "${captureSelector}" not found — make sure HandoutPage is mounted before calling.`);

  const coverEl = el.querySelector('.gr-takeaway-cover');
  const cardsEl = el.querySelector('.gr-takeaway-cards');
  const closerEl = el.querySelector('.gr-takeaway-closer');
  const cardEls = Array.from(el.querySelectorAll('.gr-takeaway-card'));

  // Measure CSS boundaries before capture (the captured canvas has no
  // DOM to query). All measurements are relative to the parent
  // .gr-takeaway so they line up with the canvas top.
  const elRect = el.getBoundingClientRect();
  const elTop = elRect.top;
  const cssTotalHeight = el.offsetHeight;

  const coverBottomCss = coverEl ? coverEl.getBoundingClientRect().bottom - elTop : 0;
  const cardsRect = cardsEl ? cardsEl.getBoundingClientRect() : null;
  const cardsTopCss = cardsRect ? cardsRect.top - elTop : coverBottomCss;
  const cardsBottomCss = cardsRect ? cardsRect.bottom - elTop : cardsTopCss;
  const closerTopCss = closerEl ? closerEl.getBoundingClientRect().top - elTop : cardsBottomCss;

  const cardCssBounds = cardsRect
    ? cardEls.map(c => {
        const r = c.getBoundingClientRect();
        return { top: r.top - cardsRect.top, bottom: r.bottom - cardsRect.top };
      })
    : [];

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#FBF4EE',
    useCORS: true,
    onclone: (clonedDoc) => {
      const dots = clonedDoc.querySelectorAll('.gr-plate-level-dot');
      dots.forEach(d => { d.style.boxShadow = 'none'; });
    },
  });

  const cssToCanvas = canvas.height / cssTotalHeight;
  const coverBottomPx = coverBottomCss * cssToCanvas;
  const cardsTopPx = cardsTopCss * cssToCanvas;
  const cardsBottomPx = cardsBottomCss * cssToCanvas;
  const closerTopPx = closerTopCss * cssToCanvas;

  // Pre-baked cover and closer images, stamped on every page.
  const coverCanvas = subCanvas(canvas, 0, coverBottomPx);
  const closerCanvas = subCanvas(canvas, closerTopPx, canvas.height);
  const cardsCanvas = subCanvas(canvas, cardsTopPx, cardsBottomPx);

  // Card boundaries relative to the cards canvas top, in canvas px.
  const cardBounds = cardCssBounds.map(b => ({
    top: b.top * cssToCanvas,
    bottom: b.bottom * cssToCanvas,
  }));

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = A4_PORTRAIT_W_PT;
  const pageH = A4_PORTRAIT_H_PT;
  const pxPerPt = canvas.width / pageW;

  const coverHeightPt = coverCanvas.height / pxPerPt;
  const closerHeightPt = closerCanvas.height / pxPerPt;
  // Visual gap between cover and cards, and between cards and closer,
  // so the cards body breathes a little inside the page frame.
  const gapPt = 16;
  const cardsTopPt = coverHeightPt + gapPt;
  const cardsAvailHeightPt = pageH - cardsTopPt - closerHeightPt - gapPt;
  const cardsAvailHeightPx = cardsAvailHeightPt * pxPerPt;
  // Card-aware break only honours a card boundary if it leaves at
  // least 25% of the cards body filled — otherwise we'd ship pages
  // that are almost empty in the middle.
  const minPageFillPx = cardsAvailHeightPx * 0.25;

  let cardsPosPx = 0;
  let pageIndex = 0;

  // Paint the page cream before stamping the cover / cards / closer
  // layers. Otherwise any uncovered area (e.g. when a card-aware
  // break ends the cards body short of the closer) reveals jsPDF's
  // default white page background as a band.
  function paintPageBg() {
    pdf.setFillColor(251, 244, 238); // var(--cream) #FBF4EE
    pdf.rect(0, 0, pageW, pageH, 'F');
  }

  // If there are no cards (participant didn't reflect on anything), the
  // PDF is just a one-page cover + closer.
  if (cardsCanvas.height <= 0 || cardsAvailHeightPx <= 0) {
    paintPageBg();
    pdf.addImage(coverCanvas, 'PNG', 0, 0, pageW, coverHeightPt);
    pdf.addImage(closerCanvas, 'PNG', 0, pageH - closerHeightPt, pageW, closerHeightPt);
    return { doc: pdf, filename: `${safeName(userName)}_Foundry_Takeaway.pdf` };
  }

  while (cardsPosPx < cardsCanvas.height) {
    const remainingPx = cardsCanvas.height - cardsPosPx;
    let endPx = Math.min(cardsPosPx + cardsAvailHeightPx, cardsCanvas.height);

    // Avoid cutting through a card: if the page edge falls inside one,
    // back the cut up to that card's top.
    let breakAt = null;
    for (const b of cardBounds) {
      const startsInRange = b.top > cardsPosPx + 1 && b.top < endPx;
      const extendsBeyond = b.bottom > endPx;
      if (startsInRange && extendsBeyond) {
        if (breakAt === null || b.top < breakAt) breakAt = b.top;
      }
    }
    if (breakAt !== null && breakAt - cardsPosPx >= minPageFillPx) {
      endPx = breakAt;
    }
    if (remainingPx <= cardsAvailHeightPx) {
      endPx = cardsCanvas.height;
    }

    const cardsSlice = subCanvas(cardsCanvas, cardsPosPx, endPx);
    const cardsSliceHeightPt = cardsSlice.height / pxPerPt;

    if (pageIndex > 0) pdf.addPage();
    paintPageBg();
    pdf.addImage(coverCanvas, 'PNG', 0, 0, pageW, coverHeightPt);
    pdf.addImage(cardsSlice, 'PNG', 0, cardsTopPt, pageW, cardsSliceHeightPt);
    pdf.addImage(closerCanvas, 'PNG', 0, pageH - closerHeightPt, pageW, closerHeightPt);

    cardsPosPx = endPx;
    pageIndex++;
  }

  return { doc: pdf, filename: `${safeName(userName)}_Foundry_Takeaway.pdf` };
}
