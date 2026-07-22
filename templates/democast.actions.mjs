// democast.actions.mjs — custom verbs for YOUR app.
//
// democast ships generic verbs (goto, wait, press, clickText, clickRole, clickLast,
// clickTitle, fillPlaceholder, fill, captureText). When your demo needs something
// domain-specific — pick a row from live API data, jump to a page built from a value
// you scraped earlier — add it here. Each verb is one async function.
//
// Signature: (ctx, args) => Promise<void>
//   ctx.page     the Playwright Page
//   ctx.base     config.baseUrl
//   ctx.vars     a shared object that persists across scenes (use with captureText)
//   ctx.request  page.request (for hitting your own API)
//   args         whatever you passed in demo.yaml after the verb name
//
// Delete the examples you do not need. This whole file is optional — remove the
// `actions:` line from democast.config.yaml if you only use the built-ins.

export default {
  // Example: pick a row that is actually available right now, instead of hardcoding
  // an id that a previous run may have consumed (which would break on a second run).
  //   - pickFreeSeat: { section: "A" }
  async pickFreeSeat(ctx, args) {
    const r = await ctx.request.get(`${ctx.base}/api/seats`);
    const seats = await r.json();
    const free = seats.find(s => s.status === 'available' && s.section === (args.section ?? 'A'));
    if (!free) throw new Error(`no free seat in section ${args.section}`);
    console.log(`      picked ${free.code}`);
    await ctx.page.getByPlaceholder('Seat code').fill(free.code);
    await ctx.page.getByRole('button', { name: 'Select' }).click();
  },

  // Example: capture a reference off the page, then navigate somewhere built from it.
  // Pair with the built-in `captureText` action, or do both here.
  //   - gotoReceipt: {}
  async gotoReceipt(ctx) {
    const body = await ctx.page.locator('body').innerText();
    const ref = (body.match(/INV-\d{4,}/) || [])[0];
    if (!ref) throw new Error('no invoice ref on screen to open');
    await ctx.page.goto(`${ctx.base}/receipt/${ref}`, { waitUntil: 'domcontentloaded' });
  },
};
