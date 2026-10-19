/* Kachó Kayente — static pickup-ordering prototype.
 * Nothing is sent or stored on a server. See submitOrder() for what a real launch needs.
 */
const CONFIG = {
  BRAND: 'Kachó Kayente',
  EVENT_NAME: '[EVENT NAME]', EVENT_DATE: '[EVENT DATE]',
  PICKUP_ADDRESS: '[PICKUP ADDRESS]', PICKUP_HOURS: '[PICKUP HOURS]', MAP_URL: '',
  CURRENCY: 'XCG', WHATSAPP_NUMBER: '', INSTAGRAM: '[@INSTAGRAM HANDLE]',
  ORDER_STATUS: 'open', DEMO_SOLD_OUT: true, SLOTS_ALL_FULL: false,
  SUBMIT_OUTCOME: 'success', CONFIRMATION_STYLE: 'request',
  SHOW_PROTOTYPE_BAR: true, SHOW_CATERING: false,
};

// Demo prices. Real prices: [TACO DOG PRICE], [BBQ DOG PRICE], [PIZZA DOG PRICE].
// Optional per product: groups: [{ id, label, choices: [{ id, label, price }] }] (required, single choice)
//                       extras: [{ id, label, price }] (optional checkboxes). None ship today.
const MENU = [
  { id: 'taco', category: 'Stuffed hot dogs', name: 'Taco Dog', price: 9, available: true,
    ingredients: 'Beef sausage, seasoned beef, shredded lettuce, cheddar, tomatoes and sour cream.' },
  { id: 'bbq', category: 'Stuffed hot dogs', name: 'BBQ Dog', price: 10, available: true,
    ingredients: 'Beef sausage wrapped in bacon, smoky BBQ sauce and caramelized onions.' },
  { id: 'pizza', category: 'Stuffed hot dogs', name: 'Pizza Dog', price: 11, available: true,
    ingredients: 'Beef sausage, marinara, mozzarella, pepperoni and Italian herbs.' },
];

// Demo slots: 15 minutes from 17:00. The real system must compute "past" in
// America/Curaçao time and enforce capacity on the server.
const DEMO_SLOT_STATES = ['past', 'past', 0, 2, 6, 0, 4, 6, 6, 0, 3, 6];

/* ---------- Demo URL parameters (QA only, never persisted) ---------- */
const params = new URLSearchParams(location.search);
const DEMO_MODE = ['status', 'slots', 'outcome', 'screen'].some(k => params.has(k));
if (['open', 'preorder', 'closed', 'soldout'].includes(params.get('status'))) CONFIG.ORDER_STATUS = params.get('status');
if (params.get('slots') === 'full') CONFIG.SLOTS_ALL_FULL = true;
if (params.get('outcome') === 'fail') CONFIG.SUBMIT_OUTCOME = 'fail';
if (CONFIG.DEMO_SOLD_OUT) MENU.find(p => p.id === 'pizza').available = false;

/* ---------- Helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => `${CONFIG.CURRENCY} ${n.toFixed(2)}`;
const icon = (name, size = 20) => `<svg class="ic" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const product = id => MENU.find(p => p.id === id);
const mq = matchMedia('(max-width: 759.98px)');
const isMobile = () => mq.matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const SLOTS = DEMO_SLOT_STATES.map((s, i) => {
  const start = 17 * 60 + i * 15;
  const cap = CONFIG.SLOTS_ALL_FULL && s !== 'past' ? 0 : s;
  return { id: hhmm(start), label: `${hhmm(start)}–${hhmm(start + 15)}`, past: cap === 'past', left: cap === 'past' ? 0 : cap };
});
const slotOpen = s => !s.past && s.left > 0;
const slotLabel = id => SLOTS.find(s => s.id === id)?.label || '';

const isSoldOut = p => CONFIG.ORDER_STATUS === 'soldout' || !p.available;
const orderingBlocked = () => CONFIG.ORDER_STATUS === 'closed' || CONFIG.ORDER_STATUS === 'soldout';

const STATUS_MSG = {
  preorder: () => `Preorders are open for ${CONFIG.EVENT_NAME} on ${CONFIG.EVENT_DATE}. Order now, pick up on the day.`,
  closed: () => `We're not taking orders right now. Check back for our next pop-up.`,
  soldout: () => `We're sold out for ${CONFIG.EVENT_NAME}. Thank you! Check back for our next pop-up.`,
};

/* ---------- State + persistence ---------- */
const STORAGE_KEY = 'kacho-kayente-order-v1';
const state = {
  cart: [],
  form: { name: '', phone: '', slot: '', note: '' },
  step: 'cart',
  errors: {},
  submitting: false,
  ref: '',
};

function load() {
  if (DEMO_MODE) return;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.cart) state.cart = saved.cart.filter(l => product(l.pid) && l.qty > 0);
    if (saved?.form) Object.assign(state.form, saved.form);
  } catch {}
}
function save() {
  if (DEMO_MODE) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ cart: state.cart, form: state.form })); } catch {}
}

function unitPrice(l) {
  const p = product(l.pid);
  let n = p.price;
  (p.groups || []).forEach(g => { n += g.choices.find(c => c.id === l.groups?.[g.id])?.price || 0; });
  (p.extras || []).forEach(e => { if (l.extras?.includes(e.id)) n += e.price; });
  return n;
}
const lineTotal = l => unitPrice(l) * l.qty;
const cartTotal = () => state.cart.reduce((s, l) => s + lineTotal(l), 0);
const cartCount = () => state.cart.reduce((s, l) => s + l.qty, 0);
function lineOptions(l) {
  const p = product(l.pid), out = [];
  (p.groups || []).forEach(g => { const c = g.choices.find(c => c.id === l.groups?.[g.id]); if (c) out.push(c.label); });
  (p.extras || []).forEach(e => { if (l.extras?.includes(e.id)) out.push(`+ ${e.label}`); });
  return out.join(', ');
}

/* ---------- Overlays (stack: drawer < sheet < WhatsApp) ---------- */
const stack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function openOverlay(el, trigger, focusEl) {
  if (!stack.some(o => o.el === el)) {
    el.hidden = false;
    stack.push({ el, trigger });
  }
  document.body.classList.add('locked');
  updateOrderBar();
  (focusEl || $(FOCUSABLE, el))?.focus();
}
function closeOverlay(el) {
  const i = stack.findIndex(o => o.el === el);
  if (i < 0) return;
  const [{ trigger }] = stack.splice(i, 1);
  el.hidden = true;
  if (!stack.length) document.body.classList.remove('locked');
  updateOrderBar();
  if (trigger && document.contains(trigger) && !trigger.closest('[hidden]')) trigger.focus();
  else if (stack.length) $('#drawerTitle').focus();
}
function dismissTop() {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (top.el.id === 'drawer') closeDrawer(); else closeOverlay(top.el);
}

document.addEventListener('keydown', e => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') { e.preventDefault(); dismissTop(); return; }
  if (e.key === 'Tab') {
    const dlg = $('[role="dialog"]', top.el);
    const items = $$(FOCUSABLE, dlg).filter(x => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
document.addEventListener('click', e => {
  const d = e.target.closest('[data-dismiss]');
  if (!d) return;
  const ov = d.closest('.overlay');
  if (ov.id === 'drawer') closeDrawer(); else closeOverlay(ov);
});

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.innerHTML = `${icon('check', 18)}<span>${esc(msg)}</span>`;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 2200);
}

/* ---------- Page ---------- */
function renderStatic() {
  $$('[data-c]').forEach(el => { el.textContent = CONFIG[el.dataset.c]; });
  $('#protoBar').hidden = !CONFIG.SHOW_PROTOTYPE_BAR;
  $('#catering').hidden = !CONFIG.SHOW_CATERING;

  const badge = $('#statusBadge');
  badge.dataset.s = CONFIG.ORDER_STATUS;
  badge.textContent = { open: 'Orders open', preorder: 'Preorders open', closed: 'Orders closed', soldout: 'Sold out' }[CONFIG.ORDER_STATUS];

  const notice = $('#heroNotice');
  const msg = STATUS_MSG[CONFIG.ORDER_STATUS];
  notice.hidden = !msg;
  if (msg) {
    $('p', notice).textContent = msg();
    notice.classList.toggle('is-preorder', CONFIG.ORDER_STATUS === 'preorder');
  }
  if (CONFIG.ORDER_STATUS === 'closed') {
    $$('[data-cta-label]').forEach(el => { el.textContent = 'View the menu'; });
    $('#ringText').textContent = 'VIEW THE MENU ✦ VIEW THE MENU ✦';
    $('.spin-badge').setAttribute('aria-label', 'View the menu');
  }

  $('#directions').outerHTML = CONFIG.MAP_URL
    ? `<a class="directions" id="directions" href="${esc(CONFIG.MAP_URL)}" target="_blank" rel="noopener">${icon('map-pin')}Get directions</a>`
    : `<div class="directions" id="directions" aria-disabled="true">${icon('map-pin')}<span>Get directions — [MAP LINK once location is confirmed]</span></div>`;

  $('#footerWa').textContent = CONFIG.WHATSAPP_NUMBER || '[WHATSAPP NUMBER]';
  const ig = CONFIG.INSTAGRAM, igReal = ig && !ig.startsWith('[');
  $('#footerIg').innerHTML = igReal
    ? `<a href="https://instagram.com/${esc(ig.replace(/^@/, ''))}" target="_blank" rel="noopener">Instagram ${esc(ig)}</a>`
    : `Instagram ${esc(ig)}`;
}

function renderMenu() {
  const cats = [...new Set(MENU.map(p => p.category))];
  const nav = $('#catNav');
  nav.hidden = cats.length < 2;
  nav.innerHTML = cats.map((c, i) => `<a href="#cat-${i}">${esc(c)}</a>`).join('');
  $('#menuGroups').innerHTML = cats.map((c, i) => `
    <div class="cat" id="cat-${i}">
      <p class="eyebrow cat__label">${esc(c)}</p>
      <ul class="rgrid cards">${MENU.filter(p => p.category === c).map(card).join('')}</ul>
    </div>`).join('');
}

// Product photos: assets/<id>.jpg (e.g. assets/taco.jpg). Missing files fall back to the placeholder.
const photo = p => `<img class="photo" src="assets/${p.id}.jpg" alt="${esc(p.name)}" width="1200" height="900" loading="lazy" onerror="this.remove()">`;

function card(p) {
  const sold = isSoldOut(p), closed = CONFIG.ORDER_STATUS === 'closed';
  const [m, d] = sold ? ['Sold out', 'Sold out'] : closed ? ['Closed', 'Ordering closed'] : ['Add', 'Add to order'];
  return `<li class="card${sold ? ' is-sold' : ''}" data-reveal>
    <div class="card__img ph">${sold ? '<span class="tag-sold">Sold out</span>' : ''}<span>PHOTO</span>${photo(p)}</div>
    <div class="card__body">
      <h3 class="ptitle card__name">${esc(p.name)}</h3>
      <p class="card__ing">${esc(p.ingredients)}</p>
      <div class="card__row">
        <span class="card__price">${money(p.price)}</span>
        <span class="card__avail${sold ? ' is-sold' : ''}">${sold ? 'Sold out' : 'Available'}</span>
      </div>
      <button class="btn btn--primary" type="button" data-add="${p.id}" ${sold || closed ? 'disabled' : ''}
        aria-label="${esc(`${d}: ${p.name}`)}">
        <span class="m-only">${m}</span><span class="d-only">${d}</span>${sold || closed ? '' : icon('plus', 18)}
      </button>
    </div>
  </li>`;
}

function renderCartUI() {
  const n = cartCount();
  $('#cartCount').textContent = n;
  $('#cartBtn').setAttribute('aria-label', `Your order, ${plural(n, 'item')}`);
  document.body.classList.toggle('has-items', n > 0);
  $('#orderBarBtn').innerHTML = `<span>View order · ${plural(n, 'item')} · ${money(cartTotal())}</span>${icon('arrow-right', 22)}`;
  updateOrderBar();
}
function updateOrderBar() {
  const show = isMobile() && cartCount() > 0 && stack.length === 0;
  $('#orderBar').hidden = !show;
  $('#footerSpacer').hidden = !show;
}
mq.addEventListener('change', updateOrderBar);

function scrollToMenu() {
  $('#menu').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth' });
}
function orderCta(trigger) {
  if (CONFIG.ORDER_STATUS !== 'closed' && cartCount() > 0) openDrawer('cart', trigger);
  else scrollToMenu();
}

/* ---------- 6.1 Product sheet ---------- */
let sheetCtx = null;

function openSheet(pid, lineId, trigger) {
  const p = product(pid);
  const line = lineId && state.cart.find(l => l.id === lineId);
  sheetCtx = {
    p, lineId,
    groups: { ...(line?.groups || {}) },
    extras: new Set(line?.extras || []),
    qty: line?.qty || 1,
    note: line?.note || '',
    errors: new Set(),
  };
  renderSheetBody();
  renderSheetFoot();
  const el = $('#sheet');
  $('.sheet', el).setAttribute('aria-labelledby', 'sheetTitle');
  openOverlay(el, trigger, $('.sheet__close', el));
  $('#sheetBody').scrollTop = 0;
}

function sheetTotal() {
  const { p, groups, extras, qty } = sheetCtx;
  return unitPrice({ pid: p.id, groups, extras: [...extras] }) * qty;
}

function renderSheetBody() {
  const { p, groups, extras, note, errors } = sheetCtx;
  $('#sheetBody').innerHTML = `
    <div class="sheet__img ph"><span>PHOTO</span>${photo(p)}
      <button class="iconbtn sheet__close" type="button" data-dismiss aria-label="Close">${icon('x', 22)}</button>
    </div>
    <div class="sheet__content">
      <h2 class="sheet__title" id="sheetTitle">${esc(p.name)}</h2>
      <p class="sheet__ing">${esc(p.ingredients)}</p>
      <p class="sheet__price">${money(p.price)}</p>
      ${(p.groups || []).map(g => `
        <fieldset class="optgroup${errors.has(g.id) ? ' has-error' : ''}" id="grp-${g.id}" ${errors.has(g.id) ? `aria-describedby="grp-${g.id}-err"` : ''}>
          <legend>${esc(g.label)} <span class="req">REQUIRED</span></legend>
          ${g.choices.map(c => `<label class="opt"><input type="radio" name="g-${g.id}" value="${esc(c.id)}" ${groups[g.id] === c.id ? 'checked' : ''}>
            <span class="opt__name">${esc(c.label)}</span><span class="opt__price${c.price ? ' is-plus' : ''}">${c.price ? `+ ${money(c.price)}` : 'Included'}</span></label>`).join('')}
          ${errors.has(g.id) ? `<p class="err" id="grp-${g.id}-err">Please choose one to continue.</p>` : ''}
        </fieldset>`).join('')}
      ${p.extras?.length ? `<fieldset class="optgroup"><legend>Extras</legend>
        ${p.extras.map(e => `<label class="opt"><input type="checkbox" name="extra" value="${esc(e.id)}" ${extras.has(e.id) ? 'checked' : ''}>
          <span class="opt__name">${esc(e.label)}</span><span class="opt__price is-plus">+ ${money(e.price)}</span></label>`).join('')}
      </fieldset>` : ''}
      <div class="field">
        <label for="prepNote">Preparation note (optional)</label>
        <textarea id="prepNote" class="sm">${esc(note)}</textarea>
        <p class="help">Allergies? Please message us before ordering — notes can't guarantee allergen-safe prep.</p>
      </div>
    </div>`;
}

function renderSheetFoot() {
  const { qty, lineId } = sheetCtx;
  const [m, d] = lineId ? ['Update', 'Update'] : ['Add', 'Add to order'];
  $('#sheetFoot').innerHTML = `
    <div class="stepper stepper--sheet" role="group" aria-label="Quantity">
      <button class="dec" type="button" data-sq="-1" aria-label="Decrease quantity" ${qty <= 1 ? 'disabled' : ''}>${icon('minus', 20)}</button>
      <output aria-live="polite">${qty}</output>
      <button class="inc" type="button" data-sq="1" aria-label="Increase quantity" ${qty >= 20 ? 'disabled' : ''}>${icon('plus', 20)}</button>
    </div>
    <button class="btn btn--primary" type="button" id="sheetAdd">
      <span><span class="m-only">${m}</span><span class="d-only">${d}</span></span><span id="sheetTotal">${money(sheetTotal())}</span>
    </button>`;
}

$('#sheet').addEventListener('change', e => {
  const t = e.target, g = t.name?.startsWith('g-') && t.name.slice(2);
  if (g) {
    sheetCtx.groups[g] = t.value;
    if (sheetCtx.errors.delete(g)) { renderSheetBody(); $(`input[name="g-${g}"]:checked`)?.focus(); }
  }
  if (t.name === 'extra') t.checked ? sheetCtx.extras.add(t.value) : sheetCtx.extras.delete(t.value);
  $('#sheetTotal').textContent = money(sheetTotal());
});
$('#sheet').addEventListener('input', e => { if (e.target.id === 'prepNote') sheetCtx.note = e.target.value; });
$('#sheet').addEventListener('click', e => {
  const q = e.target.closest('[data-sq]');
  if (q) {
    sheetCtx.qty = Math.min(20, Math.max(1, sheetCtx.qty + Number(q.dataset.sq)));
    renderSheetFoot();
    const again = $(`[data-sq="${q.dataset.sq}"]`, $('#sheetFoot'));
    (again && !again.disabled ? again : $('[data-sq]:not(:disabled)', $('#sheetFoot')))?.focus();
    return;
  }
  if (e.target.closest('#sheetAdd')) addFromSheet();
});

function addFromSheet() {
  const { p, lineId, groups, extras, qty, note } = sheetCtx;
  const missing = (p.groups || []).filter(g => !groups[g.id]).map(g => g.id);
  if (missing.length) {
    sheetCtx.errors = new Set(missing);
    renderSheetBody();
    const fs = $(`#grp-${missing[0]}`);
    fs.scrollIntoView({ block: 'center' });
    $('input', fs).focus();
    return;
  }
  const data = { pid: p.id, groups: { ...groups }, extras: [...extras].sort(), note: note.trim(), qty };
  const key = l => JSON.stringify([l.pid, l.groups, l.extras, l.note]);
  if (lineId) {
    Object.assign(state.cart.find(l => l.id === lineId), data);
  } else {
    const same = state.cart.find(l => key(l) === key(data));
    if (same) same.qty = Math.min(20, same.qty + qty);
    else state.cart.push({ id: Math.random().toString(36).slice(2, 9), ...data });
  }
  save();
  renderCartUI();
  closeOverlay($('#sheet'));
  if (!$('#drawer').hidden) renderDrawer();
  toast(lineId ? 'Item updated' : `Added ${qty}× to your order`);
}

/* ---------- 6.4 Checkout drawer ---------- */
const TITLES = { cart: 'Your order', details: 'Pickup details', review: 'Review order', confirm: 'Confirmation', failed: 'Not sent' };
const STEP_INDEX = { cart: 0, details: 1, review: 2 };

function openDrawer(step = 'cart', trigger) {
  state.step = step;
  renderDrawer();
  openOverlay($('#drawer'), trigger, $('#drawerTitle'));
}
function closeDrawer() {
  if (state.submitting) return;
  if (state.step === 'confirm') resetAfterOrder();
  closeOverlay($('#drawer'));
}
function go(step, focusSel) {
  state.step = step;
  renderDrawer();
  $('#drawerBody').scrollTop = 0;
  ((focusSel && $(focusSel, $('#drawer'))) || $('#drawerTitle')).focus();
}
function resetAfterOrder() {
  state.cart = [];
  state.form.slot = '';
  state.form.note = '';
  state.errors = {};
  state.step = 'cart';
  save();
  renderCartUI();
}

function renderDrawer() {
  const s = state.step;
  $('#drawerTitle').textContent = TITLES[s];
  const hasBack = s === 'details' || s === 'review';
  $('#drawerBack').hidden = !hasBack;
  $('.drawer__head').classList.toggle('has-back', hasBack);
  $('#drawerBack').disabled = state.submitting;
  $('#drawerClose').disabled = state.submitting;
  const ind = $('#stepInd');
  ind.hidden = !(s in STEP_INDEX);
  $$('li', ind).forEach((li, i) => {
    li.classList.toggle('is-reached', i <= STEP_INDEX[s]);
    if (i === STEP_INDEX[s]) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  ({ cart: renderCart, details: renderDetails, review: renderReview, confirm: renderConfirm, failed: renderFailed })[s]();
}

function statusBox() {
  return `<div class="box-alert" role="status">${icon('alert')}<p>${esc(STATUS_MSG[CONFIG.ORDER_STATUS]())}</p></div>`;
}

function renderCart() {
  const body = $('#drawerBody'), foot = $('#drawerFoot');
  if (!state.cart.length) {
    body.innerHTML = `<div class="empty">${icon('bag', 40)}<h3>YOUR ORDER IS EMPTY</h3><p>Add something from the menu to get started.</p></div>`;
    foot.innerHTML = `<button class="btn btn--primary" type="button" data-act="browse"><span>Browse the menu</span>${icon('arrow-right', 22)}</button>`;
    return;
  }
  const blocked = orderingBlocked(), n = cartCount();
  body.innerHTML = `
    ${blocked ? statusBox() : ''}
    <ul class="lines">${state.cart.map(l => {
      const p = product(l.pid), opts = lineOptions(l);
      return `<li class="line">
        <div class="line__top">
          <div>
            <div class="line__name">${esc(p.name)}</div>
            ${opts ? `<div class="line__sub">${esc(opts)}</div>` : ''}
            ${l.note ? `<div class="line__sub">Note: ${esc(l.note)}</div>` : ''}
            <div class="line__each">${money(unitPrice(l))} each</div>
          </div>
          <div class="line__total">${money(lineTotal(l))}</div>
        </div>
        <div class="line__ctrl">
          <div class="stepper stepper--line" role="group" aria-label="Quantity of ${esc(p.name)}">
            <button type="button" data-lq="-1" data-id="${l.id}" aria-label="${l.qty <= 1 ? `Remove ${esc(p.name)}` : `Decrease quantity of ${esc(p.name)}`}">${icon('minus', 18)}</button>
            <output aria-live="polite">${l.qty}</output>
            <button type="button" data-lq="1" data-id="${l.id}" aria-label="Increase quantity of ${esc(p.name)}" ${l.qty >= 20 ? 'disabled' : ''}>${icon('plus', 18)}</button>
          </div>
          <button class="btn--ghost" type="button" data-edit="${l.id}">Edit</button>
          <button class="btn--ghost" type="button" data-remove="${l.id}">Remove</button>
        </div>
      </li>`;
    }).join('')}</ul>
    <div class="totals">
      <div class="trow trow--sub"><span>Subtotal · ${plural(n, 'item')}</span><span class="price">${money(cartTotal())}</span></div>
      <div class="trow trow--due"><span>Total due at pickup</span><span class="amt">${money(cartTotal())}</span></div>
      <p class="payline">${icon('banknote', 18)}<span>Pay at pickup. Pickup only — no delivery, no extra fees.</span></p>
    </div>`;
  foot.innerHTML = `
    <button class="btn btn--primary" type="button" data-act="to-details" ${blocked ? 'disabled' : ''}><span>Continue to pickup details</span><span>${money(cartTotal())}</span></button>
    <div class="grid2">
      <button class="btn btn--secondary" type="button" data-act="close"><span>Keep browsing</span></button>
      <button class="btn btn--secondary" type="button" data-act="wa" ${blocked ? 'disabled' : ''}><span>Order via WhatsApp</span></button>
    </div>`;
}

function renderDetails() {
  const f = state.form, err = state.errors;
  const allFull = !SLOTS.some(slotOpen);
  const next = SLOTS.filter(slotOpen).slice(0, 3).map(s => s.id).join(', ');
  const nErr = Object.keys(err).length;
  const checkedOk = SLOTS.some(s => s.id === f.slot && slotOpen(s));
  if (!checkedOk) f.slot = '';
  const focusId = SLOTS.find(s => s.id === f.slot)?.id || SLOTS.find(slotOpen)?.id;

  $('#drawerBody').innerHTML = `
    <div class="pickbox">
      <p class="eyebrow">PICKUP AT</p>
      <strong>${esc(CONFIG.EVENT_NAME)} · ${esc(CONFIG.EVENT_DATE)}</strong>
      <span>${esc(CONFIG.PICKUP_ADDRESS)}, Willemstad</span>
      <span>${esc(CONFIG.PICKUP_HOURS)} · Curaçao time (UTC−4)</span>
    </div>
    ${nErr ? `<div class="errsum" role="alert">${icon('alert')}<span>Please fix ${plural(nErr, 'field')} below.</span></div>` : ''}
    <form id="detailsForm" novalidate style="display:flex;flex-direction:column;gap:20px">
      <div class="field">
        <label for="f-name">Your name</label>
        <input id="f-name" name="name" autocomplete="name" value="${esc(f.name)}" ${err.name ? 'aria-invalid="true" aria-describedby="f-name-err"' : ''}>
        ${err.name ? `<p class="help is-err" id="f-name-err">${esc(err.name)}</p>` : ''}
      </div>
      <div class="field">
        <label for="f-phone">WhatsApp / phone number</label>
        <input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+599 …" value="${esc(f.phone)}" aria-describedby="f-phone-help" ${err.phone ? 'aria-invalid="true"' : ''}>
        <p class="help${err.phone ? ' is-err' : ''}" id="f-phone-help">${esc(err.phone || "Include country code. We'll only use it about this order.")}</p>
      </div>
      <fieldset class="slots-fs" aria-describedby="slot-help">
        <legend>Pickup time · <span>Curaçao time · demo slots</span></legend>
        ${allFull ? `<div class="box-alert">${icon('alert')}<p><strong>Pickup capacity has been reached.</strong> Every pickup slot for ${esc(CONFIG.EVENT_NAME)} is full. Message us on WhatsApp to ask about cancellations.</p></div>` : ''}
        <div class="slots" role="radiogroup" aria-label="Pickup time" id="slotGroup" ${err.slot ? 'aria-invalid="true"' : ''}>
          ${SLOTS.map(s => {
            const open = slotOpen(s), sel = f.slot === s.id;
            const status = s.past ? 'Unavailable' : s.left === 0 ? 'Full' : s.left <= 3 ? `${s.left} left` : 'Available';
            return `<button type="button" class="slot${s.past ? ' is-past' : ''}" role="radio" aria-checked="${sel}" data-slot="${s.id}"
              tabindex="${s.id === focusId ? 0 : -1}" ${open ? '' : 'disabled'}><b>${s.label}</b>${sel ? '' : `<small>${status}</small>`}</button>`;
          }).join('')}
        </div>
        ${err.slot
          ? `<p class="help is-err" id="slot-help">${esc(err.slot)}</p>`
          : allFull ? '' : `<p class="help" id="slot-help">Some slots are full. Next available: ${esc(next)}.</p>`}
      </fieldset>
      <div class="field">
        <label for="f-note">Order note (optional)</label>
        <textarea id="f-note" name="note">${esc(f.note)}</textarea>
      </div>
    </form>`;
  $('#drawerFoot').innerHTML = `<button class="btn btn--primary" type="button" data-act="to-review"><span>Review order</span>${icon('arrow-right', 22)}</button>`;
}

function validate() {
  const f = state.form, e = {};
  if (!f.name.trim()) e.name = 'Please enter your name.';
  if (!/^\+?[0-9][0-9\s-]{6,}$/.test(f.phone.trim())) e.phone = 'Enter a WhatsApp or phone number with country code, e.g. +599.';
  if (!f.slot) e.slot = SLOTS.some(slotOpen) ? 'Choose a pickup time.' : 'No pickup slots are available.';
  return e;
}
function focusError(k) {
  const el = k === 'slot' ? $('#slotGroup [tabindex="0"]') || $('#slotGroup') : $(`#f-${k}`);
  el?.focus();
  el?.scrollIntoView({ block: 'center' });
}
// Re-render details while keeping focus and caret.
function rerenderDetails() {
  const a = document.activeElement, id = a?.id, slot = a?.dataset?.slot;
  const sel = [a?.selectionStart, a?.selectionEnd];
  const top = $('#drawerBody').scrollTop;
  renderDetails();
  $('#drawerBody').scrollTop = top;
  const el = id ? $(`#${id}`) : slot ? $(`[data-slot="${slot}"]`) : null;
  if (el) { el.focus(); if (sel[0] != null && el.setSelectionRange) el.setSelectionRange(sel[0], sel[1]); }
}

function renderReview() {
  const f = state.form, busy = state.submitting, total = cartTotal();
  $('#drawerBody').innerHTML = `
    <ul class="rv">
      <li>
        <div class="rv__head"><p class="eyebrow">ITEMS</p><button class="btn--ghost" type="button" data-act="back-cart" ${busy ? 'disabled' : ''}>Edit</button></div>
        ${state.cart.map(l => `<div class="rv__item"><span><strong>${l.qty}× ${esc(product(l.pid).name)}</strong>${lineOptions(l) ? `<br><span class="line__sub">${esc(lineOptions(l))}</span>` : ''}${l.note ? `<br><span class="line__sub">Note: ${esc(l.note)}</span>` : ''}</span><span class="price">${money(lineTotal(l))}</span></div>`).join('')}
      </li>
      <li>
        <div class="rv__due"><span><strong>Total due at pickup</strong><small>Payment: pay at pickup · [ACCEPTED PAYMENT METHODS]</small></span><span class="amt">${money(total)}</span></div>
      </li>
      <li>
        <div class="rv__head"><p class="eyebrow">YOUR DETAILS</p><button class="btn--ghost" type="button" data-act="edit-details" data-focus="#f-name" ${busy ? 'disabled' : ''}>Edit</button></div>
        <p>${esc(f.name)}<br>${esc(f.phone)}${f.note ? `<br>Note: ${esc(f.note)}` : ''}</p>
      </li>
      <li>
        <div class="rv__head"><p class="eyebrow">PICKUP</p><button class="btn--ghost" type="button" data-act="edit-details" data-focus='#slotGroup [tabindex="0"]' ${busy ? 'disabled' : ''}>Change</button></div>
        <p><strong>${esc(slotLabel(f.slot))} · ${esc(CONFIG.EVENT_DATE)}</strong><br>${esc(CONFIG.EVENT_NAME)}<br>${esc(CONFIG.PICKUP_ADDRESS)}, Willemstad</p>
      </li>
    </ul>
    <p class="dark-note">Demo only — placing this order won't send anything.</p>`;
  $('#drawerFoot').innerHTML = `
    <button class="btn btn--primary" type="button" data-act="submit" ${busy ? 'disabled aria-busy="true"' : ''}>
      <span>${busy ? 'Placing order…' : 'Place pickup order'}</span>${busy ? '<span class="spinner" aria-hidden="true"></span>' : `<span>${money(total)}</span>`}
    </button>
    <p class="foot-note">You'll pay ${money(total)} at pickup.</p>`;
}

function renderConfirm() {
  const f = state.form, confirmed = CONFIG.CONFIRMATION_STYLE === 'confirmed';
  $('#drawerBody').innerHTML = `
    <div class="banner banner--ok">
      ${icon('check', 36)}
      <h3>${confirmed ? 'ORDER PLACED' : 'ORDER REQUEST RECEIVED'}</h3>
      <p>${confirmed ? 'Your order is recorded. See you at pickup!' : "We'll confirm on WhatsApp once your order is accepted. It isn't confirmed until then."}</p>
    </div>
    <p class="ink-note" role="note">Demo only — no order has been sent.</p>
    <div class="kv"><p class="eyebrow">ORDER REFERENCE</p><p class="ref">${esc(state.ref)}</p><p>Show this at pickup.</p></div>
    <div class="kv"><p class="eyebrow">PICKUP</p>
      <p><strong>${esc(slotLabel(f.slot))} · ${esc(CONFIG.EVENT_DATE)}</strong></p>
      <p>${esc(CONFIG.EVENT_NAME)} · ${esc(CONFIG.PICKUP_ADDRESS)}, Willemstad</p>
      <p>Please arrive during your selected pickup window.</p></div>
    <div class="kv"><p class="eyebrow">ORDER SUMMARY</p>
      ${state.cart.map(l => `<div class="rv__item"><span>${l.qty}× ${esc(product(l.pid).name)}</span><span class="price">${money(lineTotal(l))}</span></div>`).join('')}</div>
    <div class="rv__due"><span><strong>Amount due at pickup</strong><small>Payment method: pay at pickup</small></span><span class="amt">${money(cartTotal())}</span></div>
    <button class="btn btn--secondary" type="button" data-act="wa">${icon('message', 20)}<span>Questions? Message us on WhatsApp</span></button>`;
  $('#drawerFoot').innerHTML = `<button class="btn btn--primary" type="button" data-act="done"><span>Back to the site</span>${icon('arrow-right', 22)}</button>`;
}

function renderFailed() {
  const f = state.form, busy = state.submitting;
  $('#drawerBody').innerHTML = `
    <div class="banner banner--fail">
      ${icon('alert', 32)}
      <h3>WE COULDN'T SEND YOUR ORDER</h3>
      <p>Your order wasn't received, so your pickup slot isn't reserved yet. Everything you entered is saved — try again, or send it to us on WhatsApp.</p>
    </div>
    <p class="ink-note" role="note">Demo of the failure state.</p>
    <div class="kv"><p class="eyebrow">SAVED</p>
      <p><strong>${plural(cartCount(), 'item')} · ${money(cartTotal())} total due at pickup</strong></p>
      <p>${esc(f.name)} · ${esc(f.phone)}</p>
      <p>${esc(slotLabel(f.slot))} · ${esc(CONFIG.EVENT_DATE)}</p></div>`;
  $('#drawerFoot').innerHTML = `
    <button class="btn btn--primary" type="button" data-act="submit" ${busy ? 'disabled aria-busy="true"' : ''}>
      <span>${busy ? 'Retrying…' : 'Try again'}</span>${busy ? '<span class="spinner" aria-hidden="true"></span>' : ''}
    </button>
    <div class="grid2">
      <button class="btn btn--secondary" type="button" data-act="wa" ${busy ? 'disabled' : ''}><span>Order via WhatsApp</span></button>
      <button class="btn btn--secondary" type="button" data-act="back-review" ${busy ? 'disabled' : ''}><span>Back to review</span></button>
    </div>`;
}

/* Drawer events */
$('#drawer').addEventListener('input', e => {
  const t = e.target;
  if (!t.form || t.form.id !== 'detailsForm') return;
  state.form[t.name] = t.value;
  save();
  if (state.errors[t.name]) { delete state.errors[t.name]; rerenderDetails(); }
});
$('#drawer').addEventListener('keydown', e => {
  const s = e.target.closest('[data-slot]');
  if (!s || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const open = $$('#slotGroup [data-slot]:not(:disabled)');
  const i = open.indexOf(s), d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
  const next = open[(i + d + open.length) % open.length];
  next.click();
});
$('#drawer').addEventListener('click', e => {
  const t = e.target.closest('button, a');
  if (!t || t.disabled) return;
  if (t.id === 'drawerClose') return closeDrawer();
  if (t.id === 'drawerBack') return go(state.step === 'review' ? 'details' : 'cart');

  if (t.dataset.slot) {
    state.form.slot = t.dataset.slot;
    delete state.errors.slot;
    save();
    return rerenderDetails();
  }
  if (t.dataset.lq) {
    const l = state.cart.find(x => x.id === t.dataset.id);
    const d = Number(t.dataset.lq);
    if (d < 0 && l.qty <= 1) return removeLine(l.id);
    l.qty = Math.min(20, l.qty + d);
    save(); renderCartUI(); renderCart();
    return $(`[data-lq="${t.dataset.lq}"][data-id="${l.id}"]`)?.focus();
  }
  if (t.dataset.edit) return openSheet(state.cart.find(l => l.id === t.dataset.edit).pid, t.dataset.edit, t);
  if (t.dataset.remove) return removeLine(t.dataset.remove);

  switch (t.dataset.act) {
    case 'browse': closeDrawer(); return scrollToMenu();
    case 'close': return closeDrawer();
    case 'to-details': state.errors = {}; return go('details');
    case 'back-cart': return go('cart');
    case 'back-review': return go('review');
    case 'edit-details': state.errors = {}; return go('details', t.dataset.focus);
    case 'to-review': {
      state.errors = validate();
      const keys = Object.keys(state.errors);
      if (keys.length) { renderDetails(); return focusError(keys[0]); }
      return go('review');
    }
    case 'submit': return placeOrder();
    case 'wa': return openWa(t);
    case 'done': resetAfterOrder(); return closeOverlay($('#drawer'));
  }
});

function removeLine(id) {
  state.cart = state.cart.filter(l => l.id !== id);
  save(); renderCartUI(); renderCart();
  $('#drawerTitle').focus();
}

/* ---------- Submit ---------- */
/**
 * submitOrder — DEMO STUB. Nothing is sent.
 * A real launch needs a Tally/Jotform form or a backend endpoint that:
 *   1. stores the order (items, total, name, phone, slot, note, status),
 *   2. notifies the owner (email and/or WhatsApp),
 *   3. enforces per-slot capacity and per-product sold-out flags server-side,
 *   4. returns a real order reference.
 * Only show the confirmation step after that request succeeds.
 */
function submitOrder(order) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (CONFIG.SUBMIT_OUTCOME === 'fail') reject(new Error('Demo failure'));
      else resolve({ reference: `DEMO-${Math.floor(1000 + Math.random() * 9000)}` });
    }, 1500);
  });
}

async function placeOrder(never = false) {
  if (state.submitting) return;
  state.submitting = true;
  renderDrawer();
  if (never) return; // ?screen=loading
  try {
    const res = await submitOrder({ items: state.cart, total: cartTotal(), ...state.form });
    state.ref = res.reference;
    state.submitting = false;
    go('confirm');
  } catch {
    state.submitting = false;
    go('failed');
  }
}

/* ---------- 6.5 WhatsApp dialog ---------- */
function waMessage() {
  const f = state.form;
  const items = state.cart.length
    ? state.cart.map(l => `${l.qty}× ${product(l.pid).name}${lineOptions(l) ? ` (${lineOptions(l)})` : ''} — ${money(lineTotal(l))}`).join('\n')
    : '[ITEMS]';
  return `Hi ${CONFIG.BRAND}! I'd like to request a pickup order for ${CONFIG.EVENT_NAME} (${CONFIG.EVENT_DATE}):

${items}

Total: ${money(cartTotal())} — pay at pickup
Requested pickup: ${slotLabel(f.slot) || '[PICKUP SLOT]'}
Name: ${f.name.trim() || '[YOUR NAME]'}

Please confirm my order. Thanks!`;
}

function openWa(trigger) {
  const msg = waMessage();
  $('#waMsg').textContent = msg;
  const link = $('#waOpen'), digits = CONFIG.WHATSAPP_NUMBER.replace(/\D/g, '');
  if (digits) {
    link.href = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    link.removeAttribute('aria-disabled');
  } else {
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.setAttribute('role', 'link');
  }
  $('#waDisabledNote').hidden = !!digits;
  $('#waCopy span').textContent = 'Copy message';
  openOverlay($('#wa'), trigger, $('#wa [data-dismiss].iconbtn'));
}
$('#waCopy').addEventListener('click', async () => {
  const text = $('#waMsg').textContent;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
  $('#waCopy span').textContent = 'Copied';
});

/* ---------- Global wiring ---------- */
document.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) return openSheet(add.dataset.add, null, add);
  const cta = e.target.closest('[data-order-cta]');
  if (cta) return orderCta(cta);
  const wa = e.target.closest('[data-open-wa]');
  if (wa) return openWa(wa);
});
$('#cartBtn').addEventListener('click', e => openDrawer('cart', e.currentTarget));
$('#orderBarBtn').addEventListener('click', e => openDrawer('cart', e.currentTarget));

/* ---------- Scroll motion: reveals, floating stickers, walking mascot ---------- */
function initMotion() {
  $$('.cards, .steps, .faq__list').forEach(list => [...list.children].forEach((c, i) => c.style.setProperty('--i', i)));
  $$('[data-reveal-group]').forEach(g => [...g.children].forEach((c, i) => { c.setAttribute('data-reveal', ''); c.style.setProperty('--i', i); }));
  if (reduceMotion.matches || !('IntersectionObserver' in window)) return; // static layout

  document.documentElement.classList.add('motion');

  // Split paragraphs into words for the scroll-lit effect
  const wordBlocks = $$('[data-words]').map(el => {
    el.innerHTML = el.textContent.split(/(\s+)/).map(t => /^\s+$/.test(t) || !t ? t : `<span class="w">${esc(t)}</span>`).join('');
    return { el, words: $$('.w', el) };
  });
  const tilts = $$('[data-tilt]');
  const ring = $('.spin-badge__ring');
  const menu = $('#menu');

  // Fade + rise as elements enter the viewport (once)
  const revealIO = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    en.target.classList.add('is-in');
    revealIO.unobserve(en.target);
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  $$('[data-reveal]').forEach(el => revealIO.observe(el));

  // Stickers pop in when their area scrolls into view, then drift at their own speed
  const floaters = $$('[data-float]').map(el => ({ el, host: el.parentElement, speed: +el.dataset.float, spin: +el.dataset.spin }));
  const liveIO = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) en.target.classList.add('is-live');
  }), { threshold: 0.15 });
  new Set(floaters.map(f => f.host)).forEach(h => liveIO.observe(h));

  // Marquee: repeat the phrase set so it can loop seamlessly
  const stand = $('#stand'), track = $('#marquee'), mascot = $('#mascot');
  const setHTML = track.innerHTML;
  let setW = 0;
  function buildMarquee() {
    track.innerHTML = setHTML;
    setW = track.scrollWidth;
    const copies = Math.ceil(innerWidth / Math.max(setW, 1)) + 1;
    track.innerHTML = setHTML.repeat(copies + 1);
  }
  buildMarquee();

  let ticking = false;
  function frame() {
    ticking = false;
    const vh = innerHeight;
    floaters.forEach(f => {
      const r = f.host.getBoundingClientRect();
      if (r.bottom < -300 || r.top > vh + 300) return;
      const d = r.top + r.height / 2 - vh / 2;
      f.el.style.transform = `translate3d(0, ${(-d * f.speed).toFixed(1)}px, 0) rotate(${(d * f.spin / 1000).toFixed(2)}deg)`;
    });
    // Words light up as the paragraph moves up the screen
    wordBlocks.forEach(({ el, words }) => {
      const r = el.getBoundingClientRect();
      const start = vh * 0.88, end = vh * 0.45 - r.height;
      const p = Math.min(1, Math.max(0, (start - r.top) / (start - end)));
      const lit = Math.round(p * words.length);
      words.forEach((w, i) => w.classList.toggle('is-lit', i < lit));
    });
    // Torn photos straighten as they reach the middle of the screen
    tilts.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      const t = Math.min(1, Math.max(-1, (r.top + r.height / 2 - vh / 2) / vh));
      el.style.transform = `rotate(${(t * 4).toFixed(2)}deg)`;
    });
    if (ring) ring.style.transform = `rotate(${(scrollY * 0.3).toFixed(1)}deg)`;
    const mr = menu.getBoundingClientRect();
    if (mr.bottom > 0 && mr.top < vh) menu.style.setProperty('--bgy', `${(-mr.top * 0.25).toFixed(1)}px`);

    const sr = stand.getBoundingClientRect();
    if (sr.bottom > 0 && sr.top < vh) {
      track.style.transform = `translate3d(${(-(scrollY * 0.45) % setW).toFixed(1)}px, 0, 0)`;
      // Mascot walks left → right as the band crosses the screen
      const p = Math.min(1, Math.max(0, (vh - sr.top) / (vh + sr.height)));
      const w = mascot.offsetWidth, travel = stand.clientWidth + w * 0.4;
      const step = Math.sin(scrollY / 26);
      mascot.style.transform = `translate3d(${(-w * 0.2 + p * (travel - w)).toFixed(1)}px, ${(-Math.abs(step) * 10).toFixed(1)}px, 0) rotate(${(step * 4).toFixed(2)}deg)`;
    }
  }
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', () => { buildMarquee(); request(); });
  frame();
}

/* ---------- Boot ---------- */
load();
renderStatic();
renderMenu();
renderCartUI();
initMotion();

// ?screen=… previews (sample cart 2× Taco Dog, Demo Customer)
const screen = params.get('screen');
if (screen) {
  const firstOpen = SLOTS.find(slotOpen)?.id || '';
  if (screen !== 'empty') state.cart = [{ id: 'demo1', pid: 'taco', groups: {}, extras: [], note: '', qty: 2 }];
  if (screen !== 'details-errors') Object.assign(state.form, { name: 'Demo Customer', phone: '+599 9 000 0000', slot: firstOpen });
  renderCartUI();
  const go2 = step => openDrawer(step, $('#cartBtn'));
  switch (screen) {
    case 'product': openSheet('taco', null, $('[data-add="taco"]')); break;
    case 'product-error': // only shows an error once a product has required option groups
      openSheet('taco', null, $('[data-add="taco"]'));
      if (product('taco').groups?.length) addFromSheet();
      break;
    case 'cart': case 'empty': go2('cart'); break;
    case 'details': go2('details'); break;
    case 'details-errors': go2('details'); state.errors = validate(); renderDetails(); focusError(Object.keys(state.errors)[0]); break;
    case 'review': go2('review'); break;
    case 'loading': go2('review'); placeOrder(true); break;
    case 'confirm': state.ref = 'DEMO-4821'; go2('confirm'); break;
    case 'failed': go2('failed'); break;
    case 'whatsapp': openWa($('#cartBtn')); break;
  }
}
