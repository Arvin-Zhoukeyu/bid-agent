const app = { state: null, view: 'dashboard', projectId: null, reqId: null, showDraft: false, busy: false };
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = { supported:'有依据', review:'待确认', gap:'材料缺口', action:'待跟进', pending:'未审核', confirmed:'已复核', needs_work:'需处理' };
const status = code => `<span class="status ${esc(code)}">${labels[code] || esc(code)}</span>`;
const project = () => app.state?.projects.find(p => p.id === app.projectId) || app.state?.projects[0];
const count = (p, key) => (p?.requirements || []).filter(r => r.status === key).length;
function toast(msg){const node=$('#toast');node.textContent=msg;node.classList.add('show');clearTimeout(window._toastTimer);window._toastTimer=setTimeout(()=>node.classList.remove('show'),6000)}
async function api(url, options={}){const response=await fetch(url,{headers:{'Content-Type':'application/json'},...options});const type=response.headers.get('Content-Type')||'';const result=type.includes('json')?await response.json():await response.text();if(!response.ok)throw new Error(result.error||`请求失败 ${response.status}`);return result}
async function refresh(){app.state=await api('/api/state');if(!app.projectId||!app.state.projects.some(p=>p.id===app.projectId))app.projectId=app.state.projects.find(p=>p.id==='demo-government')?.id||app.state.projects[0]?.id;render()}
function setView(view){app.view=view;app.showDraft=false;render();window.scrollTo({top:0,behavior:'smooth'})}
function materialText(value){return String(value??'').replaceAll('【虚构企业材料】','').replaceAll('统一社会信用代码为演示占位编号，不作为真实资质使用。','统一社会信用代码待核验，提交前须核对营业执照原件。')}
function cleanExcerpt(value){return esc(materialText(value))}
function render(){if(!app.state)return;const names={dashboard:'总览',workbench:'项目工作台',library:'企业材料库',evaluation:'效果评测'};$('#crumb').textContent=names[app.view];document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===app.view));const views={dashboard:dashboard,workbench:workbench,library:library,evaluation:evaluation};$('#content').innerHTML=views[app.view]();bindDynamic()}
function dashboard(){const projects=app.state.projects;const reqs=projects.flatMap(p=>p.requirements||[]);const gaps=reqs.filter(r=>r.status==='gap').length;return `<div class="page-head"><div><span class="eyebrow">WORKSPACE OVERVIEW</span><h1>把复杂招标要求，变成可执行清单</h1><p>从条款识别到证据核查，集中完成投标响应的第一轮工作。</p></div><button class="button primary" data-open="upload-dialog">＋ 新建项目</button></div><section class="hero"><div><span class="hero-kicker">BID INTELLIGENCE / AI-ASSISTED</span><h2>每一条响应，都有出处</h2><p>解析要求、匹配企业资料、识别缺口，生成带依据的初稿。关键判断保留人工确认。</p></div><div><button class="button" data-go="workbench">进入项目工作台 →</button></div></section><div class="stat-grid"><div class="stat"><div class="stat-label">投标项目 <span class="stat-icon">▤</span></div><strong>${projects.length}<small>个项目</small></strong></div><div class="stat"><div class="stat-label">识别要求 <span class="stat-icon">◎</span></div><strong>${reqs.length}<small>条要求</small></strong></div><div class="stat"><div class="stat-label">材料缺口 <span class="stat-icon">◇</span></div><strong>${gaps}<small>项待处理</small></strong></div><div class="stat"><div class="stat-label">企业资料 <span class="stat-icon">▦</span></div><strong>${app.state.library.length}<small>份材料</small></strong></div></div><div class="two-col"><section class="card"><div class="card-head"><h3>最近项目</h3><button class="link-button" data-go="workbench">查看全部 →</button></div>${projects.length?projects.slice(0,5).map(p=>`<div class="project-row" data-project="${esc(p.id)}"><span class="project-mark">▤</span><span class="project-info"><strong>${esc(p.name)}</strong><small>${p.requirements.length} 条要求 · ${esc(p.created_at)}</small></span>${count(p,'gap')?status('gap'):status('supported')}<span class="row-arrow">›</span></div>`).join(''):'<div class="empty">暂无项目，点击新建项目开始。</div>'}</section><section class="card"><div class="card-head"><h3>工作流程</h3><small>HUMAN IN THE LOOP</small></div><div class="card-body"><div class="workflow">${[['01','解析招标文件','将条款转为结构化要求'],['02','检索企业证据','匹配资质、案例与产品方案'],['03','生成标书初稿','形成响应表、方案框架和缺口清单'],['04','人工确认导出','复核后生成 Word 文档']].map(x=>`<div class="flow-step"><span class="flow-num">${x[0]}</span><div><strong>${x[1]}</strong><small>${x[2]}</small></div></div>`).join('')}</div></div></section></div>`}
function workbench(){
  const p=project(); if(!p)return '<div class="empty">暂无项目</div>';
  const req=p.requirements||[]; const selected=req.find(x=>x.id===app.reqId)||req[0]; app.reqId=selected?.id;
  return `<div class="page-head"><div><span class="eyebrow">PROJECT WORKBENCH</span><h1>项目工作台</h1><p>逐条核对招标要求、企业证据和响应状态。</p></div><div class="head-actions"><button class="button ghost" id="analyze-btn" title="重新读取当前材料库并匹配条款；已有草稿会清除">↻ 重新分析</button><button class="button primary" id="generate-btn" title="${p.draft?'打开已生成的草稿':'根据当前条款和企业材料生成完整标书初稿'}">${p.draft?'查看已有草稿':'✦ 生成标书初稿'}</button></div></div>
  <div class="select-row"><select id="project-select" aria-label="选择项目">${app.state.projects.map(item=>`<option value="${esc(item.id)}" ${item.id===p.id?'selected':''}>${esc(item.name)}</option>`).join('')}</select><span class="tag">${esc(p.filename)}</span><span class="tag">${esc(p.analysis_mode||'离线规则分析')}</span></div>
  ${p.analysis_error?`<div class="warning" style="margin-top:15px">${esc(p.analysis_error)}</div>`:''}
  <div class="summary-strip"><span class="mini">共 <strong>${req.length}</strong> 条要求</span><span class="mini">有依据 <strong>${count(p,'supported')}</strong></span><span class="mini">待确认 <strong>${count(p,'review')}</strong></span><span class="mini">材料缺口 <strong>${count(p,'gap')}</strong></span><span class="mini">待跟进 <strong>${count(p,'action')}</strong></span></div>
  ${app.showDraft&&p.draft?draftView(p):`<div class="work-grid"><section class="card"><div class="card-head"><h3>要求清单</h3><small>点击条款查看出处与证据</small></div><div class="requirement-list">${req.length?req.map(r=>`<div class="req-row ${r.id===selected?.id?'active':''}" data-req="${esc(r.id)}"><div class="req-top"><span class="req-id">${esc(r.id)} · ${esc(r.category)}</span>${status(r.status)}</div><h4>${esc(r.text)}</h4><div class="req-bottom"><small>原文第 ${r.line} 行 · ${r.evidence.length} 条相关材料</small>${r.review_status!=='pending'?status(r.review_status):''}</div></div>`).join(''):'<div class="empty">未识别到编号条款。请检查文件是否为可复制文本，并调整格式后重新上传。</div>'}</div></section>${selected?detailView(selected):'<div></div>'}</div>`}
  <div class="footer-note">判断结果仅用于初筛；资质原件、服务承诺及最终投标文件均需人工核对。</div>`;
}
function detailView(r){return `<aside class="card detail-card"><div class="card-head"><h3>条款详情 · ${esc(r.id)}</h3>${status(r.status)}</div><div class="detail-block"><div class="detail-label">招标原文</div><p>${esc(r.source)}</p><p style="color:#9eb0b4;font-size:10px;margin-top:5px">第 ${r.line} 行 · ${esc(r.category)}</p></div><div class="detail-block"><div class="detail-label">材料匹配判断</div><p>${esc(r.reason)}</p>${r.status==='gap'||r.status==='review'?`<button type="button" class="button primary supplement-button" data-supplement="${esc(r.id)}">＋ 补充此条款材料</button><small class="supplement-hint">保存后自动重新匹配，并清除需要更新的旧初稿</small>`:''}</div><div class="detail-block"><div class="detail-label">推荐材料</div>${r.evidence.length?r.evidence.map(e=>`<div class="evidence"><strong>${esc(e.name)}</strong><small> · ${esc(e.type)}</small><p>${cleanExcerpt(e.excerpt)}</p></div>`).join(''):'<p>暂未找到可直接支持该条款的企业材料。</p>'}</div><div class="detail-block"><div class="detail-label">人工审核</div><div class="review-buttons"><button data-review="pending" class="${r.review_status==='pending'?'selected':''}">未审核</button><button data-review="confirmed" class="${r.review_status==='confirmed'?'selected':''}">已复核</button><button data-review="needs_work" class="${r.review_status==='needs_work'?'selected':''}">需处理</button></div></div></aside>`}
function draftView(p){
  const d=p.draft;
  const categories=d.categories||[...new Set(d.sections.map(x=>x.category))].map(name=>{const rows=d.sections.filter(x=>x.category===name);return{name,count:rows.length,supported:rows.filter(x=>x.status==='supported').length,attention:rows.filter(x=>x.status!=='supported').length}});
  const evidence=d.evidence_catalog||[...new Set(d.sections.map(x=>x.evidence_name).filter(Boolean))];
  const chapters=d.chapters||[];
  return `<section class="card bid-document"><div class="card-head"><div><span class="eyebrow">BID DOCUMENT DRAFT</span><h3>${esc(d.document_title||p.name+' 投标文件初稿')}</h3><small>${esc(d.mode)} · ${esc(d.generated_at)} · ${d.sections.length} 条响应</small></div><div class="head-actions"><button class="button ghost" id="back-req">返回要求</button><button class="button ghost" id="regenerate-btn" title="重新调用生成流程并覆盖当前初稿">↻ 重新生成</button><a class="button primary" href="/api/projects/${encodeURIComponent(p.id)}/export" title="下载包含封面、响应表、逐条响应和缺口清单的 Word 文件">↓ 导出完整 Word</a></div></div>
  <div class="card-body"><div class="warning">初稿包含 ${d.summary.gap} 项材料缺口、${d.summary.review} 项待确认要求和 ${d.summary.action} 项待跟进事项。提交前须补全报价、签章、人员信息并核对全部资质与承诺。</div>
  <div class="document-overview"><div><small>项目名称</small><strong>${esc(p.name)}</strong></div><div><small>采购单位</small><strong>${esc(p.customer||'待填写')}</strong></div><div><small>引用材料</small><strong>${evidence.length} 份</strong></div><div><small>待人工处理</small><strong>${d.summary.gap+d.summary.review+d.summary.action} 项</strong></div></div>
  <div class="document-outline"><h4>标书初稿结构</h4><ol><li>项目概述</li><li>技术与服务方案</li><li>项目实施方案</li><li>项目团队</li><li>服务与质量保障</li><li>类似项目案例</li><li>招标要求响应表</li><li>商务响应</li><li>附件与证明材料</li><li>材料缺口清单</li></ol></div>
  <div class="category-grid">${categories.map(x=>`<div><strong>${esc(x.name)}</strong><span>${x.count} 条要求</span><small>${x.supported} 条有依据 · ${x.attention} 条待处理</small></div>`).join('')}</div>
  ${chapters.length?`<h4 class="section-title">正文方案预览</h4><div class="chapter-preview">${chapters.map((chapter,index)=>`<article><h4>${index+1}. ${esc(chapter.title)}</h4>${(chapter.items||[]).map(item=>`<div><strong>${esc(item.title)}</strong><p>${cleanExcerpt(item.content)}</p></div>`).join('')}</article>`).join('')}</div>`:''}
  <h4 class="section-title">第七章 · 招标要求响应表预览</h4><div class="draft-list">${d.sections.map(s=>`<article class="draft-item"><div class="draft-item-head"><h4>${esc(s.requirement_id)} · ${esc(s.category)}</h4><span class="status ${esc(s.status)}">${esc(s.response_status||labels[s.status]||s.status)}</span></div><p><strong>招标要求：</strong>${esc(s.requirement)}</p><p><strong>投标响应：</strong>${cleanExcerpt(s.response)}</p><small>证明材料：${esc(s.evidence_name||'【待补充】')} · 原文：${esc(s.source)}</small></article>`).join('')}</div></div></section>`;
}
function library(){return `<div class="page-head"><div><span class="eyebrow">KNOWLEDGE BASE</span><h1>企业材料库</h1><p>集中管理资质、案例和产品方案，作为响应生成的可核查依据。</p></div><button class="button primary" data-open="library-dialog">＋ 添加材料</button></div><section class="card"><div class="card-head"><h3>已收录材料</h3><small>${app.state.library.length} 份</small></div><div class="table-wrap"><table class="data-table"><thead><tr><th>材料名称</th><th>类别</th><th>摘要</th><th>有效期</th><th>操作</th></tr></thead><tbody>${app.state.library.map(x=>`<tr><td><button type="button" class="material-name" data-material="${esc(x.id)}">${esc(x.name)}</button><small>${esc(x.id)}</small></td><td><span class="tag">${esc(x.type)}</span></td><td>${cleanExcerpt(x.text.slice(0,95))}${x.text.length>95?'…':''}</td><td>${esc(x.valid_until||'—')}</td><td><button type="button" class="link-button" data-material="${esc(x.id)}">查看全文 →</button></td></tr>`).join('')}</tbody></table></div></section>`}
function evaluation(){return evaluationPage()}
function openMaterial(id){
  const item=app.state.library.find(x=>x.id===id);
  if(!item)return toast('材料不存在，请刷新页面');
  $('#material-title').textContent=item.name;
  $('#material-meta').textContent=`${item.type} · ${item.id}${item.valid_until?' · 有效期至 '+item.valid_until:''}`;
  $('#material-body').textContent=materialText(item.text);
  $('#material-detail-dialog').showModal();
}
function resetMaterialDialog(){
  const dialog=$('#library-dialog'),form=$('#library-form');
  form.reset();
  delete form.dataset.projectId;delete form.dataset.requirementId;
  $('#library-dialog-title').textContent='添加企业材料';
  $('#library-context').hidden=true;$('#library-context').textContent='';
  form.elements.namedItem('text').placeholder='可粘贴材料正文，或选择下方文件';
}
function supplementRequirement(reqId){
  const p=project(),r=(p.requirements||[]).find(x=>x.id===reqId);if(!r)return;
  const dialog=$('#library-dialog'),form=$('#library-form');form.reset();
  form.dataset.projectId=p.id;form.dataset.requirementId=r.id;
  $('#library-dialog-title').textContent=`补充 ${r.id} 的企业材料`;
  $('#library-context').textContent=`待证明要求：${r.text} 请补充投标企业自身的证书、案例、人员清单或承诺文件，招标方的要求文件不能作为证明。`;$('#library-context').hidden=false;
  form.elements.namedItem('name').value=`${r.id} 支撑材料`;
  form.elements.namedItem('type').value=r.category==='资格要求'?'资质':r.category==='技术要求'?'产品方案':'其他';
  form.elements.namedItem('text').placeholder='粘贴能够直接证明该要求的企业材料原文。涉及数量、证书或服务时限时，请保留完整数字、人员、证书或承诺信息。';
  dialog.querySelector('.modal-progress').hidden=true;dialog.showModal();
}
function bindDynamic(){
  document.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>setView(x.dataset.go));
  document.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>{if(x.dataset.open==='library-dialog')resetMaterialDialog();const dialog=$('#'+x.dataset.open);const progress=dialog.querySelector('.modal-progress');progress.hidden=true;progress.classList.remove('is-error');dialog.showModal()});
  document.querySelectorAll('[data-supplement]').forEach(x=>x.onclick=()=>supplementRequirement(x.dataset.supplement));
  document.querySelectorAll('[data-material]').forEach(x=>x.onclick=()=>openMaterial(x.dataset.material));
  document.querySelectorAll('[data-project]').forEach(x=>x.onclick=()=>{app.projectId=x.dataset.project;app.reqId=null;setView('workbench')});
  document.querySelectorAll('[data-req]').forEach(x=>x.onclick=()=>{app.reqId=x.dataset.req;render()});
  if($('#project-select'))$('#project-select').onchange=e=>{app.projectId=e.target.value;app.reqId=null;app.showDraft=false;render()};
  if($('#analyze-btn'))$('#analyze-btn').onclick=()=>act(async()=>{await api(`/api/projects/${app.projectId}/analyze`,{method:'POST',body:'{}'});app.showDraft=false;toast('已重新分析，材料匹配已更新')},'正在重新分析条款和匹配材料。调用大模型时可能需要 1–2 分钟，请稍候…');
  const generate=()=>act(async()=>{await api(`/api/projects/${app.projectId}/generate`,{method:'POST',body:'{}'});app.showDraft=true;toast('标书初稿已生成')},'正在生成标书初稿。调用大模型时可能需要 1–2 分钟，请稍候…');
  if($('#generate-btn'))$('#generate-btn').onclick=()=>{if(project().draft){app.showDraft=true;render()}else generate()};
  if($('#regenerate-btn'))$('#regenerate-btn').onclick=generate;
  if($('#back-req'))$('#back-req').onclick=()=>{app.showDraft=false;render()};
  document.querySelectorAll('[data-review]').forEach(x=>x.onclick=()=>act(async()=>{await api(`/api/projects/${app.projectId}/requirements/${app.reqId}`,{method:'PATCH',body:JSON.stringify({review_status:x.dataset.review})});toast('审核状态已保存')},'正在保存人工审核结果…'));
  if($('#run-eval'))$('#run-eval').onclick=()=>act(async()=>{await api('/api/evaluation/run',{method:'POST',body:'{}'});toast('评测完成')},'正在运行内置离线评测…');
}
async function act(fn,message='正在处理，请稍候…'){
  if(app.busy){const current=document.querySelector('dialog[open] .modal-progress');if(current){current.textContent='上一项操作仍在进行，请等待完成';current.hidden=false}else toast('上一项操作仍在进行，请等待完成');return}
  app.busy=true;
  const notice=$('#operation-status');
  notice.textContent=message;notice.hidden=false;
  const modalProgress=document.querySelector('dialog[open] .modal-progress');
  if(modalProgress){modalProgress.textContent=message;modalProgress.hidden=false;modalProgress.classList.remove('is-error')}
  document.body.classList.add('is-busy');
  document.querySelectorAll('dialog[open] button[type="submit"], #analyze-btn, #generate-btn, #regenerate-btn, #run-eval, [data-review]').forEach(x=>x.disabled=true);
  let succeeded=false;
  try{await fn();await refresh();succeeded=true}catch(error){
    if(modalProgress){modalProgress.textContent=error.message;modalProgress.hidden=false;modalProgress.classList.add('is-error')}
    else toast(error.message)
  }finally{
    app.busy=false;notice.hidden=true;document.body.classList.remove('is-busy');
    if(succeeded&&modalProgress)modalProgress.hidden=true;
    document.querySelectorAll('dialog[open] button[type="submit"], #analyze-btn, #generate-btn, #regenerate-btn, #run-eval, [data-review]').forEach(x=>x.disabled=false);
  }
}
async function fileBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('文件读取失败'));reader.readAsDataURL(file)})}
document.querySelectorAll('.nav-item').forEach(x=>x.onclick=()=>setView(x.dataset.view));
$('.brand').onclick=event=>{event.preventDefault();setView('dashboard')};
document.querySelectorAll('[data-close]').forEach(x=>x.onclick=()=>x.closest('dialog').close());
$('#project-form').onsubmit=event=>{event.preventDefault();act(async()=>{
  const form=event.target;const field=name=>form.elements.namedItem(name);
  const file=field('file').files[0];if(!file)throw new Error('请选择招标文件');
  const result=await api('/api/projects',{method:'POST',body:JSON.stringify({name:field('name').value,customer:field('customer').value,filename:file.name,content_base64:await fileBase64(file)})});
  $('#upload-dialog').close();form.reset();app.projectId=result.id;app.reqId=null;app.view='workbench';toast('项目已创建并完成初次分析')
},'正在上传并分析招标文件。调用大模型时可能需要 1–2 分钟，请稍候…')};
$('#library-form').onsubmit=event=>{event.preventDefault();act(async()=>{
  const form=event.target;const field=name=>form.elements.namedItem(name);
  const file=field('file').files[0];const body={name:field('name').value,type:field('type').value,valid_until:field('valid_until').value,text:field('text').value};
  if(form.dataset.projectId){body.project_id=form.dataset.projectId;body.requirement_id=form.dataset.requirementId}
  if(file){body.filename=file.name;body.content_base64=await fileBase64(file)}
  const result=await api('/api/library',{method:'POST',body:JSON.stringify(body)});$('#library-dialog').close();form.reset();
  if(body.project_id){app.showDraft=false;toast(result.requirement?.status==='supported'?'材料已保存，该条款现已判为有依据':`材料已保存，但仍为“${labels[result.requirement?.status]||'材料缺口'}”：${result.requirement?.reason||'现有材料尚不足以证明该要求'}`)}
  else toast('材料已加入知识库');resetMaterialDialog()
},'正在保存企业材料…')};
Promise.all([refresh(),api('/api/health')]).then(([,health])=>{$('#model-pill').textContent=health.model_configured?`${health.model} 已配置`:'离线规则模式'}).catch(error=>{$('#content').innerHTML=`<div class="empty">无法连接服务：${esc(error.message)}。请确认已运行 python app.py。</div>`});
