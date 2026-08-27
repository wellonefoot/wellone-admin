'use strict';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').trim().replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
const clean = v => String(v ?? '').trim();
const key = v => clean(v).toLowerCase();
const slugify = v => clean(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const splitList = v => Array.isArray(v) ? v.map(clean).filter(Boolean) : clean(v).split(/[|,\n]+/).map(x=>x.trim()).filter(Boolean);
const price = v => { v = clean(v).replace(/[₹,]/g,''); return v ? v : null; };
const rupee = v => price(v) ? '₹' + price(v) : '';
// Add a future selectable policy here, then add its SVG path in policyIconSvg().
const FIXED_PRODUCT_TERMS = Object.freeze([
  {key:'exchange', label:'7 Day Exchange Policy', description:'Eligible items can be exchanged within 7 days.'},
  {key:'delivery', label:'Free Delivery', description:'No delivery charge for this product.'},
  {key:'no-return', label:'No Return Allowed', description:'Returns and refunds are not available.'},
  {key:'pay-delivery', label:'Pay on Delivery', description:'Pay when your order is delivered.'},
  {key:'secure', label:'Secure Transaction', description:'Your order details are handled securely.'}
]);
function policyKeyFromLabel(value){
  const label = key(value).replace(/[^a-z0-9]/g,'');
  if(!label) return '';
  if(label.includes('exchange')) return 'exchange';
  if((label.includes('free') || label.includes('nocharge')) && (label.includes('delivery') || label.includes('shipping'))) return 'delivery';
  if((label.includes('no') || label.includes('non')) && (label.includes('return') || label.includes('refund'))) return 'no-return';
  if(label.includes('payondelivery') || label.includes('cashondelivery') || label === 'cod') return 'pay-delivery';
  if(label.includes('secure') && (label.includes('transaction') || label.includes('payment') || label.includes('order'))) return 'secure';
  return '';
}
function policyIconSvg(type){
  const icons = {
    exchange:'<path d="M7 7h10l-2.5-2.5M17 17H7l2.5 2.5"/><path d="M17 7l2.5 2.5L17 12M7 17l-2.5-2.5L7 12"/>',
    delivery:'<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    'no-return':'<path d="M9 7H5v4"/><path d="M5.5 10.5A7 7 0 0 1 18 8"/><path d="M18.5 13.5A7 7 0 0 1 7 17"/><path d="M4 4l16 16"/>',
    'pay-delivery':'<path d="M4 7h13a2 2 0 0 1 2 2v9H4z"/><path d="M4 7l2-3h11l2 3"/><circle cx="15.5" cy="13" r="2.5"/><path d="M15.5 11.5v3M14.5 12.2h1.5M14.5 13.8h1.5"/>',
    secure:'<path d="M12 3l7 3v5c0 4.7-2.8 8.1-7 10-4.2-1.9-7-5.3-7-10V6z"/><path d="M8.5 12.5l2.2 2.2 4.8-5"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[type] || icons.secure}</svg>`;
}
const bucket = () => ADMIN_CONFIG.storageBucket || 'product-images';
const PRODUCT_SELECT = `
  id,name,slug,description,mrp,price,main_image_url,status,stock_status,stock_quantity,track_inventory,barcode,barcode_enabled,sizes,colors,option_title,terms,created_at,updated_at,sort_order,
  categories(id,name,image_url,storage_path,description),
  subcategories(id,name),
  product_images(id,image_url,storage_path,sort_order),
  product_variants(id,label,mrp,price,image_url,image_urls,storage_paths,terms,unit,stock,stock_status,sort_order)
`;
const PRODUCT_LIST_SELECT = `
  id,name,slug,description,mrp,price,main_image_url,status,stock_status,stock_quantity,track_inventory,barcode,barcode_enabled,sizes,colors,option_title,terms,created_at,updated_at,sort_order,
  categories(id,name,image_url,storage_path,description),
  subcategories(id,name)
`;

let client;
let categories = [];
let subcategories = [];
let terms = FIXED_PRODUCT_TERMS.map(term => ({...term}));
let offers = [];
let offerItems = [];
let currentProducts = [];
let currentProductOffset = 0;
let nextProductOffset = null;
let currentImages = [];
let newImageFiles = [];
let currentCategoryImageUrl = '';
let currentCategoryStoragePath = '';
let currentOfferImageUrl = '';
let currentOfferStoragePath = '';
let currentOfferFile = null;
let currentCategoryFile = null;
let editingProductId = '';
let productSaveInProgress = false;
const STORE_CHANNEL_NAME = 'wellone-store-events-v1';
const STORE_EVENT_NAME = 'store-change';
let customerUpdateChannel = null;
let customerUpdateChannelReady = false;
let customerUpdateChannelPromise = null;

function supabaseClient(){
  if(!client){
    if(!window.supabase) throw new Error('Supabase library not loaded');
    client = window.supabase.createClient(ADMIN_CONFIG.supabaseUrl, ADMIN_CONFIG.supabaseAnonKey, {
      realtime:{params:{eventsPerSecond:10}}
    });
  }
  return client;
}
function setStatus(text, cls=''){ $('statusText').textContent = text; $('statusText').className = cls; }
function customerChangeId(){
  try{ return crypto.randomUUID(); }catch(_error){ return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}
function resetCustomerUpdateChannel(){
  const channel = customerUpdateChannel;
  customerUpdateChannel = null;
  customerUpdateChannelReady = false;
  customerUpdateChannelPromise = null;
  if(channel){
    try{ supabaseClient().removeChannel(channel); }catch(_error){}
  }
}
function ensureCustomerUpdateChannel(){
  if(customerUpdateChannelReady && customerUpdateChannel) return Promise.resolve(customerUpdateChannel);
  if(customerUpdateChannelPromise) return customerUpdateChannelPromise;
  customerUpdateChannelPromise = new Promise(resolve => {
    let settled = false;
    let timeoutId = null;
    const finish = value => {
      if(settled) return;
      settled = true;
      clearTimeout(timeoutId);
      customerUpdateChannelPromise = null;
      resolve(value);
    };
    let channel;
    try{
      channel = supabaseClient().channel(STORE_CHANNEL_NAME, {config:{broadcast:{self:false, ack:true}}});
      customerUpdateChannel = channel;
      channel.subscribe(status => {
        if(channel !== customerUpdateChannel) return;
        if(status === 'SUBSCRIBED'){
          customerUpdateChannelReady = true;
          finish(channel);
          return;
        }
        if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'){
          resetCustomerUpdateChannel();
          finish(null);
        }
      });
    }catch(_error){
      resetCustomerUpdateChannel();
      finish(null);
      return;
    }
    timeoutId = setTimeout(() => {
      if(!customerUpdateChannelReady) resetCustomerUpdateChannel();
      finish(customerUpdateChannelReady ? customerUpdateChannel : null);
    }, 4500);
  });
  return customerUpdateChannelPromise;
}
async function notifyCustomerStoreChanged(tables, action = 'update', details = null){
  const payload = {
    tables:[...new Set((tables || []).map(clean).filter(Boolean))],
    action,
    details,
    eventId:customerChangeId(),
    at:Date.now()
  };
  if(!payload.tables.length) return false;
  for(let attempt = 0; attempt < 2; attempt += 1){
    try{
      const channel = await ensureCustomerUpdateChannel();
      if(!channel) continue;
      const result = await channel.send({type:'broadcast', event:STORE_EVENT_NAME, payload});
      if(result === 'ok') return true;
    }catch(_error){}
    resetCustomerUpdateChannel();
  }
  return false;
}

function showBusy(text){ $('busyText').textContent = text; $('busy').classList.add('show'); }
function hideBusy(){ $('busy').classList.remove('show'); }
function storagePathFromUrl(url){
  url = clean(url);
  const marker = `/storage/v1/object/public/${bucket()}/`;
  const idx = url.indexOf(marker);
  if(idx === -1) return '';
  return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
}
function publicUrl(path){ return supabaseClient().storage.from(bucket()).getPublicUrl(path).data.publicUrl; }
async function compressImage(file, max = 1400, quality = 0.78){
  if(!file || !file.type.startsWith('image/')) return file;
  const dataUrl = await new Promise((resolve,reject)=>{ const r = new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });
  const img = await new Promise((resolve,reject)=>{ const i=new Image(); i.onload=()=>resolve(i); i.onerror=reject; i.src=dataUrl; });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img,0,0,w,h);
  return await new Promise(resolve => canvas.toBlob(blob => resolve(blob || file), 'image/webp', quality));
}
async function uploadFile(file, folder = 'products'){
  const blob = await compressImage(file, folder === 'offers' ? 1800 : 1400, folder === 'offers' ? 0.84 : 0.78);
  const ext = 'webp';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const {error} = await supabaseClient().storage.from(bucket()).upload(path, blob, {contentType:'image/webp', upsert:false, cacheControl:'31536000'});
  if(error) throw error;
  return {url: publicUrl(path), path};
}
async function uploadFiles(files, folder = 'products'){
  const out = [];
  for(const file of Array.from(files || [])) out.push(await uploadFile(file, folder));
  return out;
}
async function removeStorage(paths){
  const cleanPaths = [...new Set((paths || []).filter(Boolean))];
  if(!cleanPaths.length) return;
  const {error} = await supabaseClient().storage.from(bucket()).remove(cleanPaths);
  if(error) throw new Error('Storage cleanup failed: ' + error.message);
}
function normalizeProduct(row){
  if(!row) return {};
  const imgs = (row.product_images || []).slice().sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const variants = (row.product_variants || []).slice().sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  return {
    id: clean(row.id), categoryId: row.category_id || row.categories?.id || '', category: clean(row.categories?.name || row.category || ''), subcategoryId: row.subcategory_id || row.subcategories?.id || '', subcategory: clean(row.subcategories?.name || row.subcategory || ''),
    name: clean(row.name), price: price(row.price) || '', mrp: price(row.mrp) || '', image: clean(row.main_image_url || imgs[0]?.image_url || ''),
    images: imgs.map(x=>x.image_url).filter(Boolean), imagePaths: imgs.map(x=>x.storage_path || storagePathFromUrl(x.image_url)).filter(Boolean),
    sizes: clean(row.sizes || 'Standard'), colors: clean(row.colors || 'Default'), optionTitle: clean(row.option_title || ''), description: clean(row.description || ''), terms: splitList(row.terms || []), status: clean(row.status || 'active'), stockStatus: clean(row.stock_status || 'in_stock'), stockQuantity: Math.max(0, Number(row.stock_quantity || 0) || 0), trackInventory: row.track_inventory === true, barcode: clean(row.barcode || ''), barcodeEnabled: row.barcode_enabled === true,
    variants: variants.map(v => {
      const urls = splitList(v.image_urls || v.image_url || []);
      const paths = splitList(v.storage_paths || []);
      return {id:v.id, label:clean(v.label || ''), mrp:price(v.mrp) || '', price:price(v.price) || '', unit:clean(v.unit || ''), images:urls, storagePaths:paths.length ? paths : urls.map(storagePathFromUrl).filter(Boolean), terms:splitList(v.terms || []), stockQuantity:Math.max(0, Number(v.stock || 0) || 0), stockStatus:clean(v.stock_status || 'in_stock')};
    })
  };
}
function normalizeOffer(raw){ return {id:clean(raw.id), title:clean(raw.title), mrp:price(raw.mrp) || '', price:price(raw.price) || '', quantity:clean(raw.quantity || raw.subtitle), image:clean(raw.image_url), storagePath:clean(raw.storage_path || storagePathFromUrl(raw.image_url)), link:clean(raw.link), active:raw.is_active !== false}; }
function normalizeOfferItem(raw){ return {id:clean(raw.id), title:clean(raw.title), link:clean(raw.item_link), offerPrice:price(raw.offer_price) || '', discount:price(raw.discount_percentage) || '', validUntil:clean(raw.valid_until), active:raw.is_active !== false}; }
async function requireAdmin(){
  const {data:{user}} = await supabaseClient().auth.getUser();
  if(!user) throw new Error('Login required');
  const {data, error} = await supabaseClient().from('admin_users').select('id').eq('id', user.id).maybeSingle();
  if(error) throw error;
  if(!data) throw new Error('This login is not added in admin_users. Add this user UID in Supabase first.');
  return user;
}
async function ensureVariantAvailabilityReady(){
  const [variantRes, productRes] = await Promise.all([
    supabaseClient().from('product_variants').select('stock_status,stock').limit(1),
    supabaseClient().from('products').select('barcode,barcode_enabled,track_inventory,stock_quantity').limit(1)
  ]);
  const error = variantRes.error || productRes.error;
  if(!error) return;
  if(/stock_status|stock_quantity|track_inventory|barcode|column/i.test(error.message || '')) throw new Error('Run supabase/05_inventory_barcode_offers.sql in Supabase first.');
  throw error;
}
async function validateLogin(email, password){
  if(!email || !password) throw new Error('Enter admin email and password');
  const {error} = await supabaseClient().auth.signInWithPassword({email, password});
  if(error) throw error;
  await requireAdmin();
  $('loginScreen').style.display = 'none';
  $('adminShell').classList.remove('is-locked');
  ensureCustomerUpdateChannel();
  await refreshMeta();
  await loadProducts(true);
}
async function refreshMeta(){
  await requireAdmin();
  setStatus('Syncing...', 'loading');
  const [catRes, subRes, offerRes, offerItemRes] = await Promise.all([
    supabaseClient().from('categories').select('id,name,image_url,storage_path,description,sort_order,is_active').order('sort_order', {ascending:true}).order('name', {ascending:true}),
    supabaseClient().from('subcategories').select('id,category_id,name,sort_order,is_active').order('sort_order', {ascending:true}).order('name', {ascending:true}),
    supabaseClient().from('offer_slides').select('id,title,subtitle,quantity,image_url,storage_path,mrp,price,link,is_active,sort_order').order('sort_order', {ascending:true}).order('created_at', {ascending:false}),
    supabaseClient().from('offer_items').select('id,title,item_link,offer_price,discount_percentage,valid_until,is_active,sort_order,created_at').order('sort_order', {ascending:true}).order('created_at', {ascending:false})
  ]);
  if(catRes.error) throw new Error('Cannot load categories: ' + catRes.error.message);
  if(subRes.error) throw new Error('Cannot load subcategories: ' + subRes.error.message);
  categories = (catRes.data || []).map(c => ({id:c.id, name:clean(c.name), image:clean(c.image_url), storagePath:clean(c.storage_path), description:clean(c.description), active:c.is_active !== false})).filter(c=>c.name);
  subcategories = (subRes.data || []).map(s => ({id:s.id, category_id:s.category_id, name:clean(s.name), active:s.is_active !== false}));
  terms = FIXED_PRODUCT_TERMS.map(term => ({...term}));
  offers = offerRes.error ? [] : (offerRes.data || []).map(normalizeOffer);
  offerItems = offerItemRes.error ? [] : (offerItemRes.data || []).map(normalizeOfferItem);
  fillCategoryInputs(); renderCategories(); renderTermChecks(); renderOffers(); renderOfferItems();
  const promoError = offerRes.error || offerItemRes.error;
  setStatus(promoError ? 'Products loaded; run the latest offers SQL migration if promotions are unavailable.' : 'Synced ✅', promoError ? 'error' : 'ok');
}
function fillCategoryInputs(){
  const activeCats = categories.filter(c=>c.active);
  const managerOptions = activeCats.map(c => `<option value="${esc(c.name)}"></option>`).join('');
  $('categoryManagerOptions').innerHTML = managerOptions;
  const hint = $('categoryHint');
  if(hint) hint.textContent = activeCats.length ? 'Choose an existing category.' : 'Create your first category in Categories.';

  const productCategory = $('category');
  const oldProductCategory = clean(productCategory?.value);
  if(productCategory){
    productCategory.innerHTML = '<option value="">Select category</option>' + activeCats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    if(oldProductCategory && activeCats.some(c=>String(c.id)===String(oldProductCategory))) productCategory.value = oldProductCategory;
  }

  const select = $('productCategoryFilter');
  const old = select.value;
  select.innerHTML = '<option value="">All categories</option>' + activeCats.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  if(old && activeCats.some(c=>c.name===old)) select.value = old;
  renderProductSubcategoryOptions(false);
}
function selectedProductCategory(){
  const categoryId = clean($('category')?.value);
  return categories.find(c => String(c.id) === String(categoryId)) || null;
}
function productSubcategories(categoryId){
  return subcategories
    .filter(s => s.active && String(s.category_id) === String(categoryId))
    .sort((a,b) => a.name.localeCompare(b.name, undefined, {sensitivity:'base'}));
}
function setSubcategoryDropdown(open){
  const box = $('subcategoryCombobox'), input = $('subcategory'), toggle = $('subcategoryToggle'), options = $('subcategoryOptions');
  if(!box || !input || !toggle || !options) return;
  const canOpen = Boolean(selectedProductCategory()) && !input.disabled;
  const shouldOpen = Boolean(open && canOpen);
  box.classList.toggle('open', shouldOpen);
  input.setAttribute('aria-expanded', String(shouldOpen));
  toggle.setAttribute('aria-expanded', String(shouldOpen));
  options.hidden = !shouldOpen;
}
function renderProductSubcategoryOptions(open = false){
  const input = $('subcategory'), toggle = $('subcategoryToggle'), options = $('subcategoryOptions'), hint = $('subcategoryHint');
  if(!input || !toggle || !options || !hint) return;
  const category = selectedProductCategory();
  if(!category){
    input.disabled = true;
    toggle.disabled = true;
    input.placeholder = 'Select category first';
    hint.textContent = 'Select a category first.';
    options.innerHTML = '';
    setSubcategoryDropdown(false);
    return;
  }

  input.disabled = false;
  toggle.disabled = false;
  input.placeholder = 'Select subcategory';
  const value = clean(input.value);
  const all = productSubcategories(category.id);
  const visible = value ? all.filter(s => key(s.name).includes(key(value))) : all;
  const exact = value ? all.find(s => key(s.name) === key(value)) : null;
  options.innerHTML = visible.length
    ? visible.map(s => `<button type="button" class="subcategory-option${exact?.id === s.id ? ' selected' : ''}" role="option" aria-selected="${exact?.id === s.id ? 'true' : 'false'}" data-subcategory-option="${esc(s.name)}"><span>${esc(s.name)}</span><small>Existing</small></button>`).join('')
    : `<div class="subcategory-empty">${value ? `<b>Create “${esc(value)}”</b><small>This new subcategory will be added only under ${esc(category.name)}.</small>` : `<b>No subcategories yet</b><small>Type a name to create one under ${esc(category.name)}.</small>`}</div>`;
  hint.textContent = exact
    ? `Existing subcategory selected under ${category.name}.`
    : value
      ? `“${value}” will be created under ${category.name} only when you save.`
      : all.length
        ? `${all.length} subcategor${all.length === 1 ? 'y' : 'ies'} available under ${category.name}.`
        : `No existing subcategories under ${category.name}. Type a new one if needed.`;
  setSubcategoryDropdown(open);
}
function chooseProductSubcategory(name){
  $('subcategory').value = clean(name);
  renderProductSubcategoryOptions(false);
}
async function ensureCategory(name){
  const existing = categories.find(c => key(c.name) === key(name));
  if(existing) return existing;
  const {data, error} = await supabaseClient().from('categories').insert({name, slug:slugify(name), is_active:true}).select('id,name,image_url,storage_path,description,is_active').single();
  if(error) throw error;
  const cat = {id:data.id, name:data.name, image:data.image_url || '', storagePath:data.storage_path || '', description:data.description || '', active:true};
  categories.push(cat); fillCategoryInputs(); return cat;
}
async function ensureSubcategory(categoryId, name){
  if(!name) return null;
  const existing = subcategories.find(s => s.category_id === categoryId && key(s.name) === key(name));
  if(existing) return {...existing, __created:false};
  const {data, error} = await supabaseClient().from('subcategories').insert({category_id:categoryId, name, slug:slugify(name), is_active:true}).select('id,category_id,name,is_active').single();
  if(error) throw error;
  const sub = {id:data.id, category_id:data.category_id, name:data.name, active:true, __created:true};
  subcategories.push(sub); return sub;
}
async function loadProducts(reset = true){
  await requireAdmin();
  if(reset){ currentProducts = []; currentProductOffset = 0; nextProductOffset = null; }
  setStatus('Loading products...', 'loading');
  const categoryName = clean($('productCategoryFilter').value || '');
  const category = categoryName ? categories.find(c => key(c.name) === key(categoryName)) : null;
  if(categoryName && !category){ $('productList').innerHTML = '<div class="empty">Category not found. Click Sync/Load again.</div>'; return; }
  const search = clean($('searchProducts').value);
  let q = supabaseClient()
    .from('products')
    .select(PRODUCT_LIST_SELECT)
    .range(currentProductOffset, currentProductOffset + 40)
    .order('updated_at', {ascending:false, nullsFirst:false})
    .order('created_at', {ascending:false});
  if(category) q = q.eq('category_id', category.id);
  if(search){
    const term = search.replace(/[%_,()]/g,' ').trim();
    const num = Number(search.replace(/[^0-9.]/g,''));
    const subMatches = subcategories.filter(x => (x.name || '').toLowerCase().includes(search.toLowerCase())).map(x=>x.id);
    const catMatches = categories.filter(x => (x.name || '').toLowerCase().includes(search.toLowerCase())).map(x=>x.id);
    const parts = [`name.ilike.%${term}%`,`description.ilike.%${term}%`,`barcode.ilike.%${term}%`];
    if(num) parts.push(`price.eq.${num}`, `mrp.eq.${num}`);
    if(subMatches.length) parts.push(`subcategory_id.in.(${subMatches.join(',')})`);
    if(!category && catMatches.length) parts.push(`category_id.in.(${catMatches.join(',')})`);
    q = q.or(parts.join(','));
  }
  const {data, error} = await q;
  if(error) throw error;
  const rows = data || [];
  const hasMore = rows.length > 40;
  const list = (hasMore ? rows.slice(0, 40) : rows).map(normalizeProduct);
  currentProducts = reset ? list : currentProducts.concat(list);
  nextProductOffset = hasMore ? currentProductOffset + list.length : null;
  currentProductOffset = nextProductOffset || 0;
  renderProducts(reset, list);
  $('loadMoreProductsBtn').classList.toggle('hide', !nextProductOffset);
  setStatus(`Loaded ${currentProducts.length} product${currentProducts.length === 1 ? '' : 's'} ✅`,'ok');
}
function productListHtml(products){
  return (products || []).map(p => `<article class="admin-product">
    <img loading="lazy" decoding="async" src="${esc(p.image || (p.images && p.images[0]) || '')}" onerror="this.style.display='none'">
    <div><b>${esc(p.name)}</b><small>${esc(p.category)}${p.subcategory ? ' / ' + esc(p.subcategory) : ''} · ${p.mrp ? `<del>₹${esc(p.mrp)}</del> ` : ''}${p.price ? '₹'+esc(p.price) : 'Ask price'} · ${p.stockStatus === 'out_of_stock' ? 'Out of stock' : p.status !== 'active' ? 'Hidden' : 'Available'}${p.trackInventory ? ` · ${Number(p.stockQuantity || 0)} unit${Number(p.stockQuantity || 0) === 1 ? '' : 's'} in stock` : ''}${p.barcodeEnabled && p.barcode ? ` · Barcode ${esc(p.barcode)}` : ''} · ${esc(p.sizes || 'Standard')}</small></div>
    <button type="button" data-edit="${esc(p.id)}">Edit</button>
  </article>`).join('');
}
function renderProducts(reset = true, addedProducts = currentProducts){
  const box = $('productList');
  if(reset){
    box.innerHTML = currentProducts.length ? productListHtml(currentProducts) : '<div class="empty">No products found in this category.</div>';
    return;
  }
  if(addedProducts && addedProducts.length) box.insertAdjacentHTML('beforeend', productListHtml(addedProducts));
}
function renderCategories(){
  $('categoryManagerList').innerHTML = categories.length ? categories.map(c => `<article class="cat-group"><div class="cat-group-title">${c.image ? `<img src="${esc(c.image)}" onerror="this.style.display='none'">` : '<span></span>'}<div><b>${esc(c.name)}${!c.active?' (hidden)':''}</b>${c.description ? `<small>${esc(c.description)}</small>` : ''}</div><button type="button" data-cat-edit="${esc(c.name)}">Edit</button></div></article>`).join('') : '<div class="empty">No categories yet.</div>';
}
function renderTermChecks(selected = []){
  const selectedKeys = new Set((selected || []).map(policyKeyFromLabel).filter(Boolean));
  $('productTermChecks').innerHTML = terms.map(term => `<label class="policy-check">
    <input type="checkbox" value="${esc(term.label)}" ${selectedKeys.has(term.key) ? 'checked' : ''}>
    <span class="policy-check-icon">${policyIconSvg(term.key)}</span>
    <span class="policy-check-copy"><b>${esc(term.label)}</b><small>${esc(term.description)}</small></span>
  </label>`).join('');
}
function selectedProductTerms(){ return Array.from($('productTermChecks').querySelectorAll('input:checked')).map(x=>x.value); }
function renderOffers(){
  $('offerList').innerHTML = offers.length ? offers.map((o,i) => `<article class="admin-product"><img src="${esc(o.image)}" onerror="this.style.display='none'"><div><b>Banner ${i+1}</b><small>${esc(o.link || 'catalog.html')} · ${o.active?'Active':'Hidden'}</small></div><button type="button" data-offer-edit="${esc(o.id)}">Edit</button></article>`).join('') : '<div class="empty">No discount banners added yet.</div>';
}
function renderOfferItems(){
  const box = $('offerItemList');
  if(!box) return;
  const now = Date.now();
  box.innerHTML = offerItems.length ? offerItems.map(item => {
    const expiry = item.validUntil ? new Date(item.validUntil) : null;
    const expired = expiry && Number.isFinite(expiry.getTime()) && expiry.getTime() < now;
    const validity = expiry && Number.isFinite(expiry.getTime()) ? ` · Valid until ${expiry.toLocaleString()}` : ' · No expiry';
    return `<article class="admin-product offer-item-row"><div class="offer-item-icon">%</div><div><b>${esc(item.title || 'Promotional item')}</b><small>${esc(item.link)} · Offer ${rupee(item.offerPrice)}${item.discount ? ` · ${esc(item.discount)}% discount` : ''}${validity} · ${expired ? 'Expired' : item.active ? 'Active' : 'Hidden'}</small></div><button type="button" data-offer-item-edit="${esc(item.id)}">Edit</button></article>`;
  }).join('') : '<div class="empty">No promotional items added yet.</div>';
}
function switchView(view){
  document.querySelectorAll('.view-panel').forEach(x=>x.classList.remove('active'));
  const panel = $('view' + view[0].toUpperCase() + view.slice(1));
  if(panel) panel.classList.add('active');
  document.querySelectorAll('.admin-menu [data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view === view));
  $('adminMenu').classList.remove('open');
}
function renderImagePreviews(){
  const baseExisting = currentImages.map((url,i)=>`<div class="preview-item"><img src="${esc(url)}"><button type="button" data-remove-existing-image="${i}">×</button></div>`).join('');
  const newOnes = newImageFiles.map((file,i)=>`<div class="preview-item"><img src="${URL.createObjectURL(file)}"><button type="button" data-remove-new-image="${i}">×</button></div>`).join('');
  $('previewGrid').innerHTML = baseExisting + newOnes;
}
function clearProductImages(){ currentImages = []; newImageFiles = []; $('photoInput').value = ''; $('photoCameraInput').value = ''; renderImagePreviews(); }
function resetProduct(){
  editingProductId = '';
  productSaveInProgress = false;
  $('productForm').reset(); $('editId').value = ''; if($('availability')) $('availability').value = 'in_stock'; if($('productStockQuantity')) $('productStockQuantity').value = '0'; currentImages = []; newImageFiles = []; renderImagePreviews(); renderTermChecks(); renderVariantRows([]); renderProductSubcategoryOptions(false); updateInventoryControls();
  $('formTitle').textContent = 'Add product'; $('saveBtn').textContent = 'Save Product'; $('deleteBtn').style.display = 'none'; $('cancelEditBtn').classList.add('hide'); switchView('add');
}
function renderVariantRows(list = []){
  const rows = Array.isArray(list) ? list : [];
  $('variantList').innerHTML = rows.length
    ? rows.map((v,i)=>variantRowHtml(v || {},i)).join('')
    : '<div class="empty variant-empty"><b>No custom variants added.</b><span>Add only a size, option, or colour that needs its own price, images, or availability.</span></div>';
  $('variantList').querySelectorAll('.variant-row').forEach(initializeVariantRow);
}
function variantKind(v = {}){
  const explicit = clean(v.kind || v.variantKind || '');
  if(explicit === 'color' || explicit === 'colour') return 'color';
  return clean(v.unit || v.color || '') ? 'color' : 'option';
}
function variantRowHtml(v,i){
  const kind = variantKind(v);
  const value = kind === 'color' ? clean(v.unit || v.color || '') : clean(v.label || v.value || '');
  const colourSizes = kind === 'color' ? clean(v.label || v.sizes || '') : '';
  const imgs = (v.images || []).map((url,idx)=>`<div class="variant-img-chip"><img src="${esc(url)}"><button type="button" data-remove-variant-existing="${idx}" aria-label="Remove image">×</button></div>`).join('');
  return `<article class="variant-row" data-variant-index="${i}" data-existing-images='${esc(JSON.stringify(v.images || []))}' data-existing-paths='${esc(JSON.stringify(v.storagePaths || []))}'>
    <div class="variant-title"><b>Variant ${i+1}</b><button type="button" data-remove-variant="${i}">Remove</button></div>
    <div class="field-row variant-main-fields">
      <label>Variant type<select class="variant-kind"><option value="option" ${kind === 'option' ? 'selected' : ''}>Size / option</option><option value="color" ${kind === 'color' ? 'selected' : ''}>Colour</option></select></label>
      <label class="variant-value-label"><span class="variant-value-title">${kind === 'color' ? 'Colour name' : 'Size / option value'}</span><input class="variant-value" value="${esc(value)}" placeholder="${kind === 'color' ? 'Gold / Silver / Black' : '9 / 500ml / Large'}"></label>
    </div>
    <label class="variant-color-sizes ${kind === 'color' ? '' : 'hide'}">Sizes for this colour optional<input class="variant-sizes" value="${esc(colourSizes)}" placeholder="8, 9, 10 — empty uses main options"></label>
    <div class="field-row variant-stock-price-row"><label>Availability<select class="variant-availability"><option value="in_stock" ${clean(v.stockStatus || v.stock_status || 'in_stock') !== 'out_of_stock' ? 'selected' : ''}>Available</option><option value="out_of_stock" ${clean(v.stockStatus || v.stock_status || '') === 'out_of_stock' ? 'selected' : ''}>Out of stock</option></select></label><label class="variant-quantity-wrap">Available quantity<input class="variant-quantity" type="number" min="0" step="1" inputmode="numeric" value="${esc(Math.max(0, Number(v.stockQuantity ?? v.stock ?? 0) || 0))}" placeholder="0"></label><label>MRP optional<input class="variant-mrp" inputmode="numeric" value="${esc(v.mrp || '')}" placeholder="Empty = main MRP"></label></div>
    <label>Final price optional<input class="variant-price" inputmode="numeric" value="${esc(v.price || '')}" placeholder="Empty = main price"></label>
    <label class="fake-label">Separate images optional<small class="hint inline-hint">Leave empty to use the main product images.</small></label>
    <div class="variant-images">${imgs}<label class="mini-upload">+ Images<input class="variant-files" type="file" accept="image/*" multiple hidden></label></div>
  </article>`;
}
function initializeVariantRow(row){
  if(!row) return;
  row.__variantFiles = [];
  updateVariantRowMode(row);
  updateInventoryControls();
}
function updateVariantRowMode(row){
  if(!row) return;
  const kind = clean(row.querySelector('.variant-kind')?.value || 'option') === 'color' ? 'color' : 'option';
  const title = row.querySelector('.variant-value-title');
  const input = row.querySelector('.variant-value');
  const colourSizes = row.querySelector('.variant-color-sizes');
  if(title) title.textContent = kind === 'color' ? 'Colour name' : (clean($('optionTitle')?.value) || 'Size / option') + ' value';
  if(input) input.placeholder = kind === 'color' ? 'Gold / Silver / Black' : '9 / 500ml / Large';
  colourSizes?.classList.toggle('hide', kind !== 'color');
  updateVariantRowTitle(row);
}
function updateVariantRowTitle(row){
  if(!row) return;
  const index = Number(row.dataset.variantIndex || 0) + 1;
  const kind = clean(row.querySelector('.variant-kind')?.value || 'option') === 'color' ? 'color' : 'option';
  const value = clean(row.querySelector('.variant-value')?.value);
  const title = row.querySelector('.variant-title b');
  if(title) title.textContent = value || `${kind === 'color' ? 'Colour' : 'Size / option'} ${index}`;
}
function renumberVariantRows(){
  $('variantList').querySelectorAll('.variant-row').forEach((row,index)=>{
    row.dataset.variantIndex = String(index);
    updateVariantRowTitle(row);
  });
}
function nonNegativeInt(value){
  const number = Number.parseInt(String(value ?? '').replace(/[^0-9]/g,''), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function effectiveVariantStatus(row){
  const manual = clean(row.querySelector('.variant-availability')?.value || 'in_stock');
  if($('trackInventory')?.checked && nonNegativeInt(row.querySelector('.variant-quantity')?.value) <= 0) return 'out_of_stock';
  return manual === 'out_of_stock' ? 'out_of_stock' : 'in_stock';
}
function updateInventoryControls(){
  const barcodeOn = Boolean($('barcodeEnabled')?.checked);
  const track = Boolean($('trackInventory')?.checked);
  const barcodeInput = $('barcodeValue');
  if(barcodeInput) barcodeInput.disabled = !barcodeOn;
  $('barcodeFieldWrap')?.classList.toggle('is-disabled', !barcodeOn);
  const rows = Array.from($('variantList')?.querySelectorAll('.variant-row') || []);
  rows.forEach(row => {
    row.querySelector('.variant-quantity-wrap')?.classList.toggle('hide', !track);
    const qty = row.querySelector('.variant-quantity');
    if(qty) qty.disabled = !track;
    if(track && nonNegativeInt(qty?.value) <= 0){
      const availability = row.querySelector('.variant-availability');
      if(availability) availability.value = 'out_of_stock';
    }
  });
  const productQty = $('productStockQuantity');
  const hasVariants = rows.length > 0;
  if(productQty){
    productQty.disabled = !track || hasVariants;
    if(track && hasVariants) productQty.value = String(rows.reduce((sum,row)=>sum + nonNegativeInt(row.querySelector('.variant-quantity')?.value), 0));
  }
  $('productStockWrap')?.classList.toggle('is-disabled', !track);
  const hint = $('stockQuantityHint');
  if(hint) hint.textContent = hasVariants ? 'Calculated automatically from all variant quantities.' : 'Enter the available quantity for this product.';
  const summary = $('inventorySummary');
  if(summary){
    if(!track) summary.textContent = 'Stock tracking is off. Availability is controlled manually.';
    else if(hasVariants){
      const total = rows.reduce((sum,row)=>sum + nonNegativeInt(row.querySelector('.variant-quantity')?.value), 0);
      const available = rows.filter(row=>effectiveVariantStatus(row)==='in_stock').length;
      summary.textContent = `${total} total unit${total===1?'':'s'} across ${rows.length} variant${rows.length===1?'':'s'} · ${available} variant${available===1?'':'s'} currently available.`;
    }else{
      const total = nonNegativeInt(productQty?.value);
      summary.textContent = `${total} unit${total===1?'':'s'} currently available.`;
    }
  }
}
function renderVariantImages(row){
  if(!row) return;
  const holder = row.querySelector('.variant-images');
  if(!holder) return;
  const existing = JSON.parse(row.dataset.existingImages || '[]');
  const files = Array.isArray(row.__variantFiles) ? row.__variantFiles : [];
  const existingHtml = existing.map((url,index)=>`<div class="variant-img-chip"><img src="${esc(url)}"><button type="button" data-remove-variant-existing="${index}" aria-label="Remove image">×</button></div>`).join('');
  const newHtml = files.map((file,index)=>`<div class="variant-img-chip variant-new-image"><img src="${esc(URL.createObjectURL(file))}"><button type="button" data-remove-variant-new="${index}" aria-label="Remove selected image">×</button></div>`).join('');
  holder.innerHTML = `${existingHtml}${newHtml}<label class="mini-upload">+ Images<input class="variant-files" type="file" accept="image/*" multiple hidden></label>`;
  row.classList.toggle('has-new-images', files.length > 0);
}
function collectVariantRows(){
  return Array.from(document.querySelectorAll('.variant-row')).map(row => {
    const kind = clean(row.querySelector('.variant-kind')?.value || 'option') === 'color' ? 'color' : 'option';
    return {
      row,
      kind,
      value:clean(row.querySelector('.variant-value')?.value),
      sizes:kind === 'color' ? clean(row.querySelector('.variant-sizes')?.value) : '',
      mrp:price(row.querySelector('.variant-mrp')?.value),
      price:price(row.querySelector('.variant-price')?.value),
      stockQuantity:nonNegativeInt(row.querySelector('.variant-quantity')?.value),
      stockStatus:effectiveVariantStatus(row),
      terms:[],
      existingImages:JSON.parse(row.dataset.existingImages || '[]'),
      existingPaths:JSON.parse(row.dataset.existingPaths || '[]'),
      files:Array.isArray(row.__variantFiles) ? row.__variantFiles : []
    };
  }).filter(v => v.value || v.sizes || v.mrp || v.price || v.existingImages.length || v.files.length);
}
function validateVariantRows(rows){
  const used = new Set();
  const kinds = new Set(rows.map(item=>item.kind));
  if(kinds.size > 1) throw new Error('Use either Size / option variants or Colour variants for one product. For colour variants, add their sizes inside “Sizes for this colour”.');
  for(const item of rows){
    if(!item.value) throw new Error(`Enter the ${item.kind === 'color' ? 'colour name' : 'size / option value'} for every variant`);
    const duplicateKey = `${item.kind}:${key(item.value)}`;
    if(used.has(duplicateKey)) throw new Error(`Duplicate variant: ${item.value}`);
    used.add(duplicateKey);
  }
}
async function collectVariantsPayload(rows, uploadedPaths = []){
  const variants = [];
  for(const item of rows){
    const uploaded = await uploadFiles(item.files, 'variants');
    uploadedPaths.push(...uploaded.map(x=>x.path));
    variants.push({
      kind:item.kind,
      color:item.kind === 'color' ? item.value : '',
      sizes:item.kind === 'color' ? item.sizes : item.value,
      mrp:item.mrp,
      price:item.price,
      stockQuantity:item.stockQuantity || 0,
      stockStatus:item.stockStatus || 'in_stock',
      terms:item.terms,
      imageUrls:item.existingImages.concat(uploaded.map(x=>x.url)),
      storagePaths:item.existingPaths.concat(uploaded.map(x=>x.path))
    });
  }
  return variants;
}
function appendVariantRow(data = {}){
  const list = $('variantList');
  list.querySelector('.variant-empty')?.remove();
  const index = list.querySelectorAll('.variant-row').length;
  list.insertAdjacentHTML('beforeend', variantRowHtml(data, index));
  initializeVariantRow(list.lastElementChild);
}
function readVariantRowData(row){
  const kind = clean(row.querySelector('.variant-kind')?.value || 'option') === 'color' ? 'color' : 'option';
  const value = clean(row.querySelector('.variant-value')?.value);
  return {
    kind,
    unit: kind === 'color' ? value : '',
    label: kind === 'color' ? clean(row.querySelector('.variant-sizes')?.value) : value,
    mrp: price(row.querySelector('.variant-mrp')?.value),
    price: price(row.querySelector('.variant-price')?.value),
    stockQuantity: nonNegativeInt(row.querySelector('.variant-quantity')?.value),
    stockStatus: effectiveVariantStatus(row),
    images: JSON.parse(row.dataset.existingImages || '[]'),
    storagePaths: JSON.parse(row.dataset.existingPaths || '[]'),
    terms: []
  };
}
async function openProduct(id){
  await ensureVariantAvailabilityReady();
  const {data,error}=await supabaseClient().from('products').select(PRODUCT_SELECT).eq('id', id).single();
  if(error) throw error;
  const p = normalizeProduct(data);
  if(!p || !p.id) return;
  editingProductId = p.id;
  $('editId').value = p.id; $('category').value = p.categoryId || categories.find(c=>key(c.name)===key(p.category))?.id || ''; $('subcategory').value = p.subcategory; renderProductSubcategoryOptions(false); $('productName').value = p.name; $('mrp').value = p.mrp; $('price').value = p.price; $('optionTitle').value = p.optionTitle || ''; $('sizes').value = p.sizes; $('colors').value = p.colors; $('description').value = p.description; if($('availability')) $('availability').value = p.status !== 'active' ? 'hidden' : (p.stockStatus || 'in_stock'); if($('barcodeEnabled')) $('barcodeEnabled').checked = p.barcodeEnabled; if($('barcodeValue')) $('barcodeValue').value = p.barcode || ''; if($('trackInventory')) $('trackInventory').checked = p.trackInventory; if($('productStockQuantity')) $('productStockQuantity').value = String(p.stockQuantity || 0);
  currentImages = p.images && p.images.length ? p.images : (p.image ? [p.image] : []); newImageFiles = []; renderImagePreviews(); renderTermChecks(p.terms);
  renderVariantRows(p.variants || []);
  $('formTitle').textContent = 'Edit product'; $('saveBtn').textContent = 'Update Product'; $('deleteBtn').style.display = 'inline-flex'; $('cancelEditBtn').classList.remove('hide'); switchView('add');
}
async function saveProduct(event){
  event.preventDefault();
  if(productSaveInProgress) return;
  productSaveInProgress = true;
  $('saveBtn').disabled = true;
  const newlyUploadedPaths = [];
  let databaseWriteStarted = false;
  try{
    await requireAdmin();
    await ensureVariantAvailabilityReady();
    const hiddenId = clean($('editId').value);
    const id = clean(editingProductId || hiddenId);
    if(editingProductId && hiddenId && editingProductId !== hiddenId) throw new Error('Product edit state changed. Reopen the product and try again.');
    const categoryId = clean($('category').value), name = clean($('productName').value), pr = price($('price').value);
    const category = categories.find(c => String(c.id) === String(categoryId) && c.active);
    if(!category || !name || !pr) throw new Error('Select category, enter product name and final price');
    const variantDrafts = collectVariantRows();
    validateVariantRows(variantDrafts);
    const barcodeEnabled = Boolean($('barcodeEnabled')?.checked);
    const barcode = clean($('barcodeValue')?.value);
    if(barcodeEnabled && !barcode) throw new Error('Enter a barcode, or turn Barcode identification off.');
    if(barcodeEnabled){
      let barcodeQuery = supabaseClient().from('products').select('id,name').eq('barcode', barcode).limit(1);
      if(id) barcodeQuery = barcodeQuery.neq('id', id);
      const {data:barcodeMatch,error:barcodeError}=await barcodeQuery;
      if(barcodeError) throw barcodeError;
      if((barcodeMatch || []).length) throw new Error(`Barcode ${barcode} is already linked to ${barcodeMatch[0].name || 'another product'}.`);
    }
    const trackInventory = Boolean($('trackInventory')?.checked);
    if(!id && !currentImages.length && !newImageFiles.length && !variantDrafts.some(v=>v.files.length || v.existingImages.length)) throw new Error('Choose at least one product image');
    showBusy(id ? 'Updating product...' : 'Saving product...'); setStatus(id ? 'Updating product...' : 'Saving product...', 'loading');
    const sub = await ensureSubcategory(category.id, clean($('subcategory').value));
    const newUploads = await uploadFiles(newImageFiles, 'products');
    newlyUploadedPaths.push(...newUploads.map(x=>x.path));
    const variantRows = await collectVariantsPayload(variantDrafts, newlyUploadedPaths);
    const allImages = currentImages.concat(newUploads.map(x=>x.url));
    const allPaths = currentImages.map(storagePathFromUrl).filter(Boolean).concat(newUploads.map(x=>x.path));
    const availability = clean($('availability')?.value || 'in_stock');
    const calculatedStock = variantRows.length ? variantRows.reduce((sum,v)=>sum + nonNegativeInt(v.stockQuantity), 0) : nonNegativeInt($('productStockQuantity')?.value);
    const anyVariantAvailable = variantRows.some(v => v.stockStatus !== 'out_of_stock' && nonNegativeInt(v.stockQuantity) > 0);
    const trackedStatus = variantRows.length ? (anyVariantAvailable ? 'in_stock' : 'out_of_stock') : (calculatedStock > 0 ? 'in_stock' : 'out_of_stock');
    const row = {category_id:category.id, subcategory_id:sub?.id || null, name, slug:slugify(name) + '-' + Date.now(), description:clean($('description').value), mrp:price($('mrp').value), price:pr, main_image_url:allImages[0] || variantRows[0]?.imageUrls?.[0] || '', option_title:clean($('optionTitle').value), sizes:clean($('sizes').value) || variantRows.find(v=>v.kind === 'option')?.sizes || 'Standard', colors:clean($('colors').value) || 'Default', terms:selectedProductTerms(), status: availability === 'hidden' ? 'hidden' : 'active', stock_status: trackInventory ? trackedStatus : (availability === 'out_of_stock' ? 'out_of_stock' : 'in_stock'), stock_quantity:trackInventory ? calculatedStock : 0, track_inventory:trackInventory, barcode:barcode || null, barcode_enabled:barcodeEnabled, updated_at:new Date().toISOString()};
    let productId = id;
    let oldImagePaths = [];
    let oldVariantPaths = [];
    databaseWriteStarted = true;
    if(id){
      const {data:oldImgs,error:oldImgsError}=await supabaseClient().from('product_images').select('storage_path,image_url').eq('product_id', id); if(oldImgsError) throw oldImgsError;
      oldImagePaths = (oldImgs || []).map(x=>x.storage_path || storagePathFromUrl(x.image_url)).filter(Boolean);
      const {data:oldVars,error:oldVarsError}=await supabaseClient().from('product_variants').select('storage_paths,image_url,image_urls').eq('product_id', id); if(oldVarsError) throw oldVarsError;
      oldVariantPaths = (oldVars || []).flatMap(v => splitList(v.storage_paths || []).concat(splitList(v.image_urls || v.image_url || []).map(storagePathFromUrl))).filter(Boolean);
      const {data:updated,error}=await supabaseClient().from('products').update(row).eq('id', id).select('id').single(); if(error) throw error;
      if(!updated || updated.id !== id) throw new Error('Product update failed. No new product was created.');
    }else{
      row.created_at = new Date().toISOString();
      const {data,error}=await supabaseClient().from('products').insert(row).select('id').single(); if(error) throw error; productId = data.id;
    }
    const deleteImages = await supabaseClient().from('product_images').delete().eq('product_id', productId); if(deleteImages.error) throw deleteImages.error;
    if(allImages.length){
      const imageRows = allImages.map((url,i)=>({product_id:productId, image_url:url, storage_path:allPaths[i] || storagePathFromUrl(url), sort_order:i}));
      const {error}=await supabaseClient().from('product_images').insert(imageRows); if(error) throw error;
    }
    const deleteVariants = await supabaseClient().from('product_variants').delete().eq('product_id', productId); if(deleteVariants.error) throw deleteVariants.error;
    if(variantRows.length){
      const rows = variantRows.map((v,i)=>({product_id:productId, label:v.sizes || '', unit:v.color || '', mrp:v.mrp || null, price:v.price || null, image_url:v.imageUrls[0] || '', image_urls:v.imageUrls, storage_paths:v.storagePaths, terms:v.terms, stock:trackInventory ? nonNegativeInt(v.stockQuantity) : 0, stock_status:trackInventory && nonNegativeInt(v.stockQuantity) <= 0 ? 'out_of_stock' : (v.stockStatus || 'in_stock'), sort_order:i}));
      const {error}=await supabaseClient().from('product_variants').insert(rows); if(error){ if(/stock_status/i.test(error.message || '')) throw new Error('Run supabase/05_inventory_barcode_offers.sql in Supabase, then save again.'); throw error; }
    }
    const keepPaths = new Set(allPaths.concat(variantRows.flatMap(v=>v.storagePaths)));
    await removeStorage(oldImagePaths.concat(oldVariantPaths).filter(p => !keepPaths.has(p)));
    await notifyCustomerStoreChanged(['products','product_images','product_variants', ...(!id ? ['categories'] : []), ...(sub && sub.__created ? ['subcategories'] : [])], id ? 'product-update' : 'product-insert', {productId, categoryId:category.id, subcategoryCreated:Boolean(sub && sub.__created)});
    await refreshMeta(); await loadProducts(true); resetProduct(); hideBusy(); setStatus(id ? 'Product updated ✅' : 'Product saved ✅', 'ok');
  }catch(err){
    if(!databaseWriteStarted && newlyUploadedPaths.length) await removeStorage(newlyUploadedPaths).catch(()=>{});
    hideBusy(); setStatus(err.message, 'error');
  }finally{
    productSaveInProgress = false;
    $('saveBtn').disabled = false;
  }
}
async function deleteProduct(){
  const id = clean($('editId').value); if(!id) return;
  if(!confirm('Delete this product? Its uploaded Supabase Storage images will also be deleted.')) return;
  try{
    showBusy('Deleting product...');
    const {data:imgs,error:imgsError}=await supabaseClient().from('product_images').select('storage_path,image_url').eq('product_id', id); if(imgsError) throw imgsError;
    const {data:vars,error:varsError}=await supabaseClient().from('product_variants').select('storage_paths,image_url,image_urls').eq('product_id', id); if(varsError) throw varsError;
    const paths = (imgs || []).map(x=>x.storage_path || storagePathFromUrl(x.image_url)).concat((vars || []).flatMap(v => splitList(v.storage_paths || []).concat(splitList(v.image_urls || v.image_url || []).map(storagePathFromUrl)))).filter(Boolean);
    const {error}=await supabaseClient().from('products').delete().eq('id', id); if(error) throw error;
    await removeStorage(paths);
    await notifyCustomerStoreChanged(['products','product_images','product_variants','categories'], 'product-delete', {productId:id});
    await refreshMeta(); await loadProducts(true); resetProduct(); hideBusy(); setStatus('Product deleted ✅','ok');
  }catch(err){ hideBusy(); setStatus(err.message,'error'); }
}
function resetCategory(){ $('categoryForm').reset(); $('categoryOldName').value=''; $('categoryDescriptionInput').value=''; currentCategoryImageUrl=''; currentCategoryStoragePath=''; currentCategoryFile=null; $('categoryImageInput').value=''; $('categoryCameraInput').value=''; $('categoryPreview').removeAttribute('src'); $('deleteCategoryBtn').style.display='none'; $('saveCategoryBtn').textContent='Save Category'; }
function openCategory(name){ const c = categories.find(x=>key(x.name)===key(name)); if(!c) return; $('categoryOldName').value=c.name; $('categoryNameInput').value=c.name; $('categoryDescriptionInput').value=c.description || ''; currentCategoryImageUrl=c.image || ''; currentCategoryStoragePath=c.storagePath || storagePathFromUrl(c.image); currentCategoryFile=null; if(c.image) $('categoryPreview').src=c.image; $('deleteCategoryBtn').style.display='inline-flex'; $('saveCategoryBtn').textContent='Update Category'; switchView('categories'); }
async function saveCategory(event){
  event.preventDefault();
  try{
    const oldName = clean($('categoryOldName').value), name = clean($('categoryNameInput').value), description = clean($('categoryDescriptionInput').value); if(!name) throw new Error('Enter category name');
    showBusy(oldName ? 'Updating category...' : 'Saving category...');
    const old = categories.find(c=>key(c.name)===key(oldName));
    const oldCategoryPath = old ? (old.storagePath || storagePathFromUrl(old.image)) : '';
    let imageUrl = currentCategoryImageUrl, storagePath = currentCategoryStoragePath;
    if(currentCategoryFile){ const up = await uploadFile(currentCategoryFile, 'categories'); imageUrl = up.url; storagePath = up.path; }
    if(old){ const {error}=await supabaseClient().from('categories').update({name, slug:slugify(name), description, image_url:imageUrl, storage_path:storagePath, is_active:true}).eq('id', old.id); if(error) throw error; }
    else { const {error}=await supabaseClient().from('categories').insert({name, slug:slugify(name), description, image_url:imageUrl, storage_path:storagePath, is_active:true}); if(error) throw error; }
    if(currentCategoryFile && oldCategoryPath && oldCategoryPath !== storagePath){ await removeStorage([oldCategoryPath]); }
    await notifyCustomerStoreChanged(['categories'], old ? 'category-update' : 'category-insert', {oldName, name});
    await refreshMeta(); resetCategory(); hideBusy(); setStatus('Category saved ✅','ok');
  }catch(err){ hideBusy(); setStatus(err.message,'error'); }
}
async function deleteCategory(){ const name=clean($('categoryOldName').value); if(!name) return; if(!confirm(`Delete category ${name}? Products under it will lose category.`)) return; try{ showBusy('Deleting category...'); const c=categories.find(x=>key(x.name)===key(name)); if(c){ const {error}=await supabaseClient().from('categories').delete().eq('id', c.id); if(error) throw error; await removeStorage([c.storagePath || storagePathFromUrl(c.image)]); } await notifyCustomerStoreChanged(['categories','subcategories','products'], 'category-delete', {name}); await refreshMeta(); resetCategory(); hideBusy(); setStatus('Category deleted ✅','ok'); }catch(err){ hideBusy(); setStatus(err.message,'error'); } }
function toDatetimeLocal(value){
  if(!value) return '';
  const d = new Date(value);
  if(!Number.isFinite(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}
function resetOfferItem(){
  $('offerItemForm')?.reset();
  if($('offerItemId')) $('offerItemId').value='';
  if($('offerItemActive')) $('offerItemActive').checked=true;
  if($('deleteOfferItemBtn')) $('deleteOfferItemBtn').style.display='none';
}
function openOfferItem(id){
  const item = offerItems.find(x=>x.id===id); if(!item) return;
  $('offerItemId').value=item.id; $('offerItemLink').value=item.link || ''; $('offerItemPrice').value=item.offerPrice || ''; $('offerItemTitle').value=item.title || ''; $('offerItemDiscount').value=item.discount || ''; $('offerItemValidUntil').value=toDatetimeLocal(item.validUntil); $('offerItemActive').checked=item.active; $('deleteOfferItemBtn').style.display='inline-flex'; switchView('offers');
}
async function saveOfferItem(event){
  event.preventDefault();
  try{
    await requireAdmin();
    const id=clean($('offerItemId').value), link=clean($('offerItemLink').value), offerPrice=price($('offerItemPrice').value), discount=price($('offerItemDiscount').value), validLocal=clean($('offerItemValidUntil').value);
    if(!link || !offerPrice) throw new Error('Enter the product link and offer price.');
    if(discount !== null && (Number(discount) < 0 || Number(discount) > 100)) throw new Error('Discount percentage must be between 0 and 100.');
    const validUntil = validLocal ? new Date(validLocal) : null;
    if(validUntil && !Number.isFinite(validUntil.getTime())) throw new Error('Enter a valid offer expiry date and time.');
    showBusy(id?'Updating offer item...':'Saving offer item...');
    const row={title:clean($('offerItemTitle').value) || null,item_link:link,offer_price:Number(offerPrice),discount_percentage:discount===null?null:Number(discount),valid_until:validUntil?validUntil.toISOString():null,is_active:$('offerItemActive').checked,updated_at:new Date().toISOString()};
    if(id){ const {error}=await supabaseClient().from('offer_items').update(row).eq('id',id); if(error) throw error; }
    else { row.created_at=new Date().toISOString(); const {error}=await supabaseClient().from('offer_items').insert(row); if(error) throw error; }
    await notifyCustomerStoreChanged(['offer_items'], id?'offer-item-update':'offer-item-insert', {offerItemId:id || ''});
    await refreshMeta(); resetOfferItem(); hideBusy(); setStatus(id?'Offer item updated ✅':'Offer item saved ✅','ok');
  }catch(err){ hideBusy(); setStatus(err.message,'error'); }
}
async function deleteOfferItem(){
  const id=clean($('offerItemId').value); if(!id) return;
  if(!confirm('Delete this promotional item?')) return;
  try{ showBusy('Deleting offer item...'); const {error}=await supabaseClient().from('offer_items').delete().eq('id',id); if(error) throw error; await notifyCustomerStoreChanged(['offer_items'],'offer-item-delete',{offerItemId:id}); await refreshMeta(); resetOfferItem(); hideBusy(); setStatus('Offer item deleted ✅','ok'); }catch(err){ hideBusy(); setStatus(err.message,'error'); }
}

function resetOffer(){ $('offerForm').reset(); $('offerId').value=''; currentOfferImageUrl=''; currentOfferStoragePath=''; currentOfferFile=null; $('offerPreview').removeAttribute('src'); $('offerActive').checked=true; $('deleteOfferBtn').style.display='none'; }
function openOffer(id){ const o = offers.find(x=>x.id===id); if(!o) return; $('offerId').value=o.id; $('offerTitle').value=o.title || ''; $('offerMrp').value=o.mrp || ''; $('offerPrice').value=o.price || ''; $('offerQuantity').value=o.quantity || ''; $('offerLink').value=o.link || ''; $('offerActive').checked=o.active; currentOfferImageUrl=o.image; currentOfferStoragePath=o.storagePath || storagePathFromUrl(o.image); currentOfferFile=null; if(o.image) $('offerPreview').src=o.image; $('deleteOfferBtn').style.display='inline-flex'; switchView('offers'); }
async function saveOffer(event){
  event.preventDefault();
  try{
    const id=clean($('offerId').value), title=clean($('offerTitle').value) || `Banner ${Date.now()}`; if(!currentOfferFile && !currentOfferImageUrl) throw new Error('Select a banner image');
    showBusy(id?'Updating offer...':'Saving offer...');
    const oldOffer = id ? offers.find(x=>x.id===id) : null;
    const oldOfferPath = oldOffer ? (oldOffer.storagePath || storagePathFromUrl(oldOffer.image)) : '';
    let imageUrl = currentOfferImageUrl, storagePath = currentOfferStoragePath;
    if(currentOfferFile){ const up = await uploadFile(currentOfferFile, 'offers'); imageUrl = up.url; storagePath = up.path; }
    const row={title, mrp:null, price:null, quantity:'', subtitle:'', link:clean($('offerLink').value)||'catalog.html', is_active:$('offerActive').checked, image_url:imageUrl, storage_path:storagePath};
    if(id){ const {error}=await supabaseClient().from('offer_slides').update(row).eq('id', id); if(error) throw error; }
    else { const {error}=await supabaseClient().from('offer_slides').insert(row); if(error) throw error; }
    if(currentOfferFile && oldOfferPath && oldOfferPath !== storagePath){ await removeStorage([oldOfferPath]); }
    await notifyCustomerStoreChanged(['offer_slides'], id ? 'offer-update' : 'offer-insert', {offerId:id || ''});
    await refreshMeta(); resetOffer(); hideBusy(); setStatus('Offer saved ✅','ok');
  }catch(err){ hideBusy(); setStatus(err.message,'error'); }
}
async function deleteOffer(){ const id=clean($('offerId').value); if(!id) return; if(!confirm('Delete this offer slide?')) return; try{ showBusy('Deleting offer...'); const o=offers.find(x=>x.id===id); const {error}=await supabaseClient().from('offer_slides').delete().eq('id', id); if(error) throw error; await removeStorage([o?.storagePath || storagePathFromUrl(o?.image)]); await notifyCustomerStoreChanged(['offer_slides'], 'offer-delete', {offerId:id}); await refreshMeta(); resetOffer(); hideBusy(); setStatus('Offer deleted ✅','ok'); }catch(err){ hideBusy(); setStatus(err.message,'error'); } }
async function checkManualBarcode(code){
  code=clean(code); if(!code){ setStatus('Enter a barcode to check.','error'); return; }
  try{
    showBusy('Checking barcode...');
    const {data,error}=await supabaseClient().from('products').select('id,name,barcode,barcode_enabled').eq('barcode',code).eq('barcode_enabled',true).maybeSingle();
    if(error) throw error;
    hideBusy();
    if(data?.id){
      await openProduct(data.id);
      setStatus(`Opened ${data.name || 'product'} for barcode ${code}.`,'ok');
      return;
    }
    resetProduct();
    $('barcodeEnabled').checked=true;
    $('barcodeValue').value=code;
    updateInventoryControls();
    setStatus(`Barcode ${code} is not assigned yet. A new product form is ready with this barcode.`,'ok');
  }catch(err){
    hideBusy();
    setStatus(err.message,'error');
  }
}

async function lockAdmin(){ resetCustomerUpdateChannel(); try{ await supabaseClient().auth.signOut(); }catch(e){} $('adminShell').classList.add('is-locked'); $('loginScreen').style.display='grid'; if($('adminPasswordInput')) $('adminPasswordInput').value=''; setStatus('Login required'); }
function bindEvents(){
  $('menuToggle').addEventListener('click', () => { const open = $('adminMenu').classList.toggle('open'); $('menuToggle').setAttribute('aria-expanded', String(open)); });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); switchView(b.dataset.view); }));
  $('logoutBtn').addEventListener('click', lockAdmin);
  $('loginForm').addEventListener('submit', async e => { e.preventDefault(); $('loginError').textContent='Checking...'; try{ await validateLogin(clean($('adminEmailInput').value), clean($('adminPasswordInput').value)); $('loginError').textContent=''; }catch(err){ $('loginError').textContent=err.message; } });
  $('newProductBtn').addEventListener('click', resetProduct);
  $('barcodeEnabled').addEventListener('change', updateInventoryControls);
  $('trackInventory').addEventListener('change', updateInventoryControls);
  $('productStockQuantity').addEventListener('input', updateInventoryControls);
  $('reloadProductsBtn').addEventListener('click', () => loadProducts(true).catch(err=>setStatus(err.message,'error')));
  $('productCategoryFilter').addEventListener('change', () => loadProducts(true).catch(err=>setStatus(err.message,'error')));
  $('category').addEventListener('change', () => { $('subcategory').value = ''; renderProductSubcategoryOptions(false); });
  $('subcategory').addEventListener('focus', () => renderProductSubcategoryOptions(true));
  $('subcategory').addEventListener('input', () => renderProductSubcategoryOptions(true));
  $('subcategoryToggle').addEventListener('click', () => {
    const isOpen = $('subcategoryCombobox').classList.contains('open');
    renderProductSubcategoryOptions(!isOpen);
    if(!isOpen) $('subcategory').focus();
  });
  $('searchProducts').addEventListener('input', () => { clearTimeout(window.__adminSearchTimer); window.__adminSearchTimer = setTimeout(() => loadProducts(true).catch(err=>setStatus(err.message,'error')), 350); });
  $('searchProducts').addEventListener('keydown', e => { if(e.key==='Enter') loadProducts(true).catch(err=>setStatus(err.message,'error')); });
  $('loadMoreProductsBtn').addEventListener('click', () => loadProducts(false).catch(err=>setStatus(err.message,'error')));
  $('photoPicker').addEventListener('click', () => $('photoInput').click());
  $('photoInput').addEventListener('change', () => { newImageFiles.push(...Array.from($('photoInput').files || [])); $('photoInput').value=''; renderImagePreviews(); });
  $('clearAllImagesBtn').addEventListener('click', clearProductImages);
  $('addVariantBtn').addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); appendVariantRow({kind:'option',label:'',mrp:'',price:'',images:[],storagePaths:[],terms:[]}); });
  $('productForm').addEventListener('submit', saveProduct); $('deleteBtn').addEventListener('click', deleteProduct); $('cancelEditBtn').addEventListener('click', resetProduct);
  $('categoryPhotoPicker').addEventListener('click', () => $('categoryImageInput').click());
  $('categoryImageInput').addEventListener('change', () => { currentCategoryFile = $('categoryImageInput').files[0] || null; if(currentCategoryFile) $('categoryPreview').src = URL.createObjectURL(currentCategoryFile); });
  $('categoryForm').addEventListener('submit', saveCategory); $('deleteCategoryBtn').addEventListener('click', deleteCategory);
  $('offerPhotoPicker').addEventListener('click', () => $('offerImageInput').click());
  $('offerImageInput').addEventListener('change', () => { currentOfferFile = $('offerImageInput').files[0] || null; if(currentOfferFile) $('offerPreview').src = URL.createObjectURL(currentOfferFile); });
  $('offerItemForm').addEventListener('submit', saveOfferItem); $('cancelOfferItemBtn').addEventListener('click', resetOfferItem); $('deleteOfferItemBtn').addEventListener('click', deleteOfferItem);
  $('offerForm').addEventListener('submit', saveOffer); $('cancelOfferBtn').addEventListener('click', resetOffer); $('deleteOfferBtn').addEventListener('click', deleteOffer);
  $('barcodeLookupForm').addEventListener('submit', e => {
    e.preventDefault();
    checkManualBarcode($('barcodeLookupInput').value);
  });
  document.addEventListener('click', e => {
    const subcategoryOption = e.target.closest('[data-subcategory-option]');
    if(subcategoryOption){ chooseProductSubcategory(subcategoryOption.dataset.subcategoryOption); return; }
    if(!e.target.closest('#subcategoryCombobox')) setSubcategoryDropdown(false);
    const edit = e.target.closest('[data-edit]'); if(edit) openProduct(edit.dataset.edit).catch(err=>setStatus(err.message,'error'));
    const cat = e.target.closest('[data-cat-edit]'); if(cat) openCategory(cat.dataset.catEdit);
    const offer = e.target.closest('[data-offer-edit]'); if(offer) openOffer(offer.dataset.offerEdit);
    const offerItem = e.target.closest('[data-offer-item-edit]'); if(offerItem) openOfferItem(offerItem.dataset.offerItemEdit);
    const re = e.target.closest('[data-remove-existing-image]'); if(re){ currentImages.splice(Number(re.dataset.removeExistingImage),1); renderImagePreviews(); }
    const rn = e.target.closest('[data-remove-new-image]'); if(rn){ newImageFiles.splice(Number(rn.dataset.removeNewImage),1); renderImagePreviews(); }
    const rv = e.target.closest('[data-remove-variant]'); if(rv){ rv.closest('.variant-row')?.remove(); if(!$('variantList').querySelector('.variant-row')) renderVariantRows([]); else renumberVariantRows(); updateInventoryControls(); }
    const existingImage = e.target.closest('[data-remove-variant-existing]'); if(existingImage){ const row=existingImage.closest('.variant-row'); if(row){ const index=Number(existingImage.dataset.removeVariantExisting || 0); const imgs=JSON.parse(row.dataset.existingImages || '[]'); const paths=JSON.parse(row.dataset.existingPaths || '[]'); imgs.splice(index,1); paths.splice(index,1); row.dataset.existingImages=JSON.stringify(imgs); row.dataset.existingPaths=JSON.stringify(paths); renderVariantImages(row); } }
    const newImage = e.target.closest('[data-remove-variant-new]'); if(newImage){ const row=newImage.closest('.variant-row'); if(row){ row.__variantFiles = Array.isArray(row.__variantFiles) ? row.__variantFiles : []; row.__variantFiles.splice(Number(newImage.dataset.removeVariantNew || 0),1); renderVariantImages(row); } }
  });
  document.addEventListener('change', e => {
    if(e.target.classList.contains('variant-kind')) updateVariantRowMode(e.target.closest('.variant-row'));
    if(e.target.classList.contains('variant-availability')) updateInventoryControls();
    if(e.target.classList.contains('variant-files')){ const row=e.target.closest('.variant-row'); if(row){ row.__variantFiles = Array.isArray(row.__variantFiles) ? row.__variantFiles : []; row.__variantFiles.push(...Array.from(e.target.files || [])); e.target.value=''; renderVariantImages(row); } }
  });
  document.addEventListener('input', e => {
    if(e.target.classList.contains('variant-value')) updateVariantRowTitle(e.target.closest('.variant-row'));
    if(e.target.classList.contains('variant-quantity')) updateInventoryControls();
    if(e.target.id === 'optionTitle') $('variantList').querySelectorAll('.variant-row').forEach(updateVariantRowMode);
  });
}
bindEvents(); renderVariantRows([]); updateInventoryControls(); resetOfferItem(); lockAdmin();
