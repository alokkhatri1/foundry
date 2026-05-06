// Build the takeaway as a designed, single-page PDF by capturing a
// React-rendered <HandoutPage> via html2canvas and embedding it into
// jsPDF. The handout layout is sized to fit one A4 portrait page; if
// a participant's content exceeds that (very long reflections), the
// PDF stays a single page — overflow is cropped rather than spilling
// into a second page, because the takeaway is meant to be a one-page
// keepsake.
//
// Same image-based-PDF tradeoff as the certificate: not text-searchable,
// but renders exactly as styled.

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
      // html2canvas@1.4.x can't parse color-mix() / oklab and throws if
      // it hits one. The graduation level dot uses color-mix for its
      // halo — strip its box-shadow on the clone before render.
      const dots = clonedDoc.querySelectorAll('.gr-plate-level-dot');
      dots.forEach(d => { d.style.boxShadow = 'none'; });
    },
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = A4_PORTRAIT_W_PT;
  const pageH = A4_PORTRAIT_H_PT;

  // Embed the captured canvas into a single A4 page. If the captured
  // canvas's aspect ratio is taller than A4, crop it to one page worth
  // (top of the canvas — the cover, hero, ladder are the load-bearing
  // sections). If shorter, embed at scale so it sits in the upper
  // portion of the page with cream below.
  const pxPerPt = canvas.width / pageW;
  const onePagePx = Math.floor(pageH * pxPerPt);

  if (canvas.height <= onePagePx) {
    const heightPt = canvas.height / pxPerPt;
    pdf.addImage(canvas, 'PNG', 0, 0, pageW, heightPt);
  } else {
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = onePagePx;
    const ctx = slice.getContext('2d');
    ctx.fillStyle = '#FBF4EE';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, 0);
    pdf.addImage(slice, 'PNG', 0, 0, pageW, pageH);
  }

  return { doc: pdf, filename: `${safeName(userName)}_Foundry_Takeaway.pdf` };
}
