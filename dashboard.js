'use strict';
(function () {
  const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const number = value => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value);
  const shortDate = date => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5,7))-1]}`;
  const fullDate = date => `${shortDate(date)} ${date.slice(0,4)}`;
  function dateValid(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
  }
  function validate(payload) {
    if (!payload || payload.schema_version !== 1 || payload.scope !== 'mion_the_kargo' || payload.timezone !== 'Europe/Istanbul') throw new Error('Veri kapsamı doğrulanamadı.');
    if (!['historical','connected'].includes(payload.source_state) || !['shared_daily_values','bigquery','migpack'].includes(payload.source)) throw new Error('Veri kaynağı doğrulanamadı.');
    if (!dateValid(payload.period_start) || !dateValid(payload.period_end) || payload.period_end < payload.period_start) throw new Error('Veri dönemi geçersiz.');
    if (payload.source_state === 'connected' && (payload.source === 'shared_daily_values' || !payload.updated_at || !Number.isFinite(Date.parse(payload.updated_at)) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(payload.updated_at))) throw new Error('Kaynak güncelleme zamanı eksik.');
    if (!Array.isArray(payload.days) || !payload.days.length || payload.days.length > 3660) throw new Error('Günlük değerler eksik.');
    const days = payload.days.map(day => {
      if (!day || !dateValid(day.date) || !['active','closed','no_orders'].includes(day.status)) throw new Error('Günlük değer geçersiz.');
      if (day.status === 'closed' ? day.orders !== null : !Number.isSafeInteger(day.orders) || day.orders < 0) throw new Error('Sipariş adedi geçersiz.');
      if ((day.status === 'active' && day.orders === 0) || (day.status === 'no_orders' && day.orders !== 0)) throw new Error('Günlük durum ve sipariş adedi uyuşmuyor.');
      return {date:day.date, status:day.status, orders:day.orders};
    }).sort((a,b) => a.date.localeCompare(b.date));
    if (days[0].date !== payload.period_start || days.at(-1).date !== payload.period_end) throw new Error('Dönem kapsamı eksik.');
    for (let i=1; i<days.length; i++) {
      if (Date.parse(days[i].date) - Date.parse(days[i-1].date) !== 86400000) throw new Error('Eksik veya tekrarlanan gün var.');
    }
    const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if (payload.period_end > today) throw new Error('Gelecek tarih sonuçlara eklenemez.');
    return {...payload, days};
  }
  function summarize(days) {
    const total = days.reduce((sum,day) => sum+(day.orders ?? 0),0);
    const orderedDays = days.filter(day => day.orders > 0).length;
    const peak = days.reduce((best,day) => (day.orders ?? 0) > (best?.orders ?? -1) ? day : best, null);
    return {total, orderedDays, closed:days.filter(day=>day.status==='closed').length, average:orderedDays ? total/orderedDays : 0, peak};
  }
  function monthly(days) {
    const groups = new Map();
    for (const day of days) {
      const key = day.date.slice(0,7);
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(day);
    }
    return Array.from(groups, ([key,days]) => ({key, label:`${MONTHS[Number(key.slice(5))-1]} ${key.slice(0,4)}`, days, ...summarize(days)}));
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {validate, summarize, monthly};
  if (typeof document === 'undefined') return;

  let dataset = null;
  let selectedPeriod = 'all';
  let busy = false;
  const byId = id => document.getElementById(id);
  const set = (id,value) => {byId(id).textContent=value;};
  const statusLabel = day => day.status==='closed' ? 'Depo kapalı' : day.status==='no_orders' ? 'Sipariş yok' : 'Sipariş alındı';
  const range = days => `${fullDate(days[0].date)} – ${fullDate(days.at(-1).date)}`;
  function node(tag, text, className) {const result=document.createElement(tag);if(text!==undefined)result.textContent=text;if(className)result.className=className;return result;}
  function renderSummary() {
    const stats=summarize(dataset.days), months=monthly(dataset.days);
    set('periodSubtitle',`${range(dataset.days)} · Günlük sipariş dağılımı ve aylık karşılaştırma`);
    document.querySelector('meta[name="description"]').content=`Mion The Kargo sipariş performansı · ${range(dataset.days)}`;
    set('totalValue',number(stats.total));
    set('totalHint',`${months.length} aylık dönem`);
    set('totalChip',range(dataset.days));
    set('activeValue',`${stats.orderedDays} gün`);
    set('activeHint',`${dataset.days.length} takvim günü`);
    set('closedChip',`${stats.closed} gün depo kapalı`);
    set('averageValue',number(stats.average));
    const previous=months.at(-2), current=months.at(-1);
    const change=previous?.average > 0 ? (current.average/previous.average-1)*100 : null;
    const avgChip=byId('averageChip');
    avgChip.textContent=change===null ? 'Sipariş oluşan günler üzerinden' : `${current.label} ortalaması ${change<0?'−':'+'}%${number(Math.abs(change))}`;
    avgChip.className=`chip ${change===null?'neutral':change<0?'warn':''}`;
    set('peakValue',number(stats.peak?.orders ?? 0));
    set('peakHint',stats.peak ? fullDate(stats.peak.date) : '—');
    set('peakChip',`${current.label} zirvesi ${number(current.peak?.orders ?? 0)}`);
    byId('monthCards').replaceChildren(...months.map((month,index)=>{
      const article=node('article',undefined,`card month ${index%2?'nov':''}`);
      const head=node('div',undefined,'month-head');head.append(node('div',month.label,'month-title'),node('div',`${shortDate(month.days[0].date)} – ${shortDate(month.days.at(-1).date)}`,'month-period'));
      const stats=node('div',undefined,'month-stats');
      for(const [value,label] of [[month.total,'Sipariş'],[month.orderedDays,'Siparişli gün'],[month.average,'Günlük ortalama'],[month.peak?.orders ?? 0,'En yüksek hacim']]){const mini=node('div',undefined,'mini');mini.append(node('strong',number(value)),node('span',label));stats.append(mini);}
      article.append(head,stats);return article;
    }));
    if(selectedPeriod!=='all'&&!months.some(month=>month.key===selectedPeriod))selectedPeriod='all';
    byId('periodFilters').replaceChildren(...[{key:'all',label:'Tümü'},...months].map(month=>{
      const button=node('button',month.label,`filter ${selectedPeriod===month.key?'active':''}`);
      button.type='button';button.dataset.period=month.key;button.setAttribute('aria-pressed',String(selectedPeriod===month.key));
      button.addEventListener('click',()=>{selectedPeriod=month.key;renderSummary();renderDetail();});return button;
    }));
    const source=dataset.source==='bigquery'?'BigQuery':dataset.source==='migpack'?'Migpack':'Paylaşılan günlük değerler';
    let update='Kaynak bağlantısı bekleniyor';
    if(dataset.updated_at)update=`Veri güncellemesi: ${new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Istanbul'}).format(new Date(dataset.updated_at))}`;
    set('dataFooter',`Kaynak: ${source} · Son veri günü: ${fullDate(dataset.period_end)} · ${update}`);
    byId('csvBtn').disabled=false;
  }
  function renderDetail() {
    const visible=dataset.days.filter(day=>selectedPeriod==='all'||day.date.startsWith(selectedPeriod));
    const stats=summarize(visible), months=monthly(dataset.days);
    const averages=new Map(months.map(month=>[month.key,month.average]));
    set('chartContext',`${range(visible)} · ${number(stats.total)} sipariş · ${stats.orderedDays} siparişli gün`);
    set('closedDays',visible.some(day=>day.status==='closed')?`Kapalı günler: ${visible.filter(day=>day.status==='closed').map(day=>shortDate(day.date)).join(', ')}`:'Bu dönemde doğrulanmış kapalı gün bulunmuyor.');
    set('rowCount',`${visible.length} takvim günü`);
    byId('dailyRows').replaceChildren(...visible.map(day=>{
      const row=node('tr');const date=node('td');date.append(node('strong',fullDate(day.date)));
      const status=node('td');status.append(node('span',statusLabel(day),`status ${day.status==='closed'?'closed':''}`));
      const difference=day.orders===null ? null : day.orders-averages.get(day.date.slice(0,7));
      row.append(date,node('td',MONTHS[Number(day.date.slice(5,7))-1]),node('td',day.orders===null?'—':number(day.orders),'num'),status,node('td',difference===null?'—':`${difference>=0?'+':''}${number(difference)}`));return row;
    }));
    renderChart(visible,averages);
  }
  function renderChart(days,averages) {
    const svg=byId('chart'), NS='http://www.w3.org/2000/svg';svg.replaceChildren();
    const W=Math.max(1180,days.length*48),H=410,m={l:54,r:24,t:28,b:64};
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('width',W);svg.setAttribute('aria-label',`${range(days)} günlük sipariş grafiği`);
    byId('chartWrap').style.minWidth=`${W}px`;
    const maximum=Math.max(1,...days.map(day=>day.orders ?? 0));
    const step=Math.max(1,Math.ceil(maximum/4/Math.pow(10,Math.floor(Math.log10(maximum/4))))*Math.pow(10,Math.floor(Math.log10(maximum/4))));
    const max=Math.max(4,step*4),cw=W-m.l-m.r,ch=H-m.t-m.b;
    const x=i=>m.l+(days.length===1?cw/2:i*cw/(days.length-1)),y=value=>m.t+ch-value/max*ch;
    const add=(tag,attrs,text)=>{const item=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>item.setAttribute(k,v));if(text!==undefined)item.textContent=text;svg.append(item);return item;};
    for(let i=0;i<=4;i++){const value=max*i/4;add('line',{x1:m.l,y1:y(value),x2:W-m.r,y2:y(value),class:'gridline'});add('text',{x:m.l-12,y:y(value)+4,'text-anchor':'end',class:'axis-label'},number(value));}
    days.forEach((day,i)=>{if(day.status==='closed'){add('rect',{x:x(i)-18,y:m.t,width:36,height:ch,class:'closed-band'});add('text',{x:x(i),y:m.t+14,'text-anchor':'middle',class:'closed-label'},'KAPALI');}});
    let start=0;
    for(let i=1;i<=days.length;i++){if(i===days.length||days[i].date.slice(0,7)!==days[start].date.slice(0,7)){const average=averages.get(days[start].date.slice(0,7));add('line',{x1:x(start),y1:y(average),x2:x(i-1),y2:y(average),class:'avg-line'});if(i<days.length)add('line',{x1:(x(i-1)+x(i))/2,y1:m.t,x2:(x(i-1)+x(i))/2,y2:m.t+ch,class:'split'});start=i;}}
    let segment=[];const flush=()=>{if(segment.length>1)add('polyline',{points:segment.map(([i,value])=>`${x(i)},${y(value)}`).join(' '),class:'order-line'});segment=[];};
    days.forEach((day,i)=>{if(day.orders===null)flush();else segment.push([i,day.orders]);});flush();
    days.forEach((day,i)=>{add('text',{x:x(i),y:H-25,'text-anchor':'middle',class:'axis-label'},shortDate(day.date).replace('Ekim','Eki').replace('Kasım','Kas'));if(day.orders!==null){const point=add('circle',{cx:x(i),cy:y(day.orders),r:5,class:'point'});const title=document.createElementNS(NS,'title');title.textContent=`${fullDate(day.date)}: ${number(day.orders)} sipariş`;point.append(title);add('text',{x:x(i),y:y(day.orders)-11,'text-anchor':'middle',class:'data-label'},number(day.orders));}});
  }
  function showStatus(message,error=false) {set('syncStatus',message);byId('syncStatus').className=`sync-status ${error?'sync-error':''}`;}
  async function refresh() {
    if(busy)return;busy=true;byId('refreshBtn').disabled=true;
    if(!dataset)showStatus('Sipariş verileri yükleniyor…');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try {
      const url=new URL('./data/orders.json',document.baseURI);url.searchParams.set('v',Date.now());
      const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:controller.signal});
      if(!response.ok)throw new Error('Sipariş verileri alınamadı.');
      const incoming=validate(await response.json());
      if(dataset && incoming.period_end<dataset.period_end)throw new Error('Eski veri sürümü alındı.');
      dataset=incoming;renderSummary();renderDetail();
      const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const age=Date.now()-Date.parse(dataset.updated_at);
      if(dataset.source_state==='historical')showStatus(`Geçmiş veriler gösteriliyor · ${fullDate(dataset.period_end)} tarihine kadar · Otomatik aktarım bağlantı bekliyor`);
      else if(!Number.isFinite(age)||age< -300000||age>86400000||Date.parse(today)-Date.parse(dataset.period_end)>86400000)showStatus(`Veriler güncel olmayabilir · Son veri günü ${fullDate(dataset.period_end)}`,true);
      else showStatus(`Otomatik veri aktarımı · ${fullDate(dataset.period_end)} tarihine kadar · Sayfa 5 dakikada bir yeni veriyi kontrol eder`);
    } catch(error) {
      showStatus(dataset?'Veri yenilenemedi. Son başarıyla alınan değerler gösteriliyor.':'Sipariş verileri yüklenemedi. Yenile düğmesiyle tekrar deneyin.',true);
    } finally {clearTimeout(timer);busy=false;byId('refreshBtn').disabled=false;}
  }
  byId('refreshBtn').addEventListener('click',refresh);
  byId('csvBtn').addEventListener('click',()=>{
    if(!dataset)return;
    const days=dataset.days.filter(day=>selectedPeriod==='all'||day.date.startsWith(selectedPeriod));
    const lines=[['Tarih','Sipariş','Durum'],...days.map(day=>[day.date,day.orders??'',statusLabel(day)])];
    const url=URL.createObjectURL(new Blob(['\ufeff'+lines.map(row=>row.join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const link=node('a');link.href=url;link.download='mion-the-kargo-siparisleri.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(()=>{if(!document.hidden)refresh();},300000);
  refresh();
})();
